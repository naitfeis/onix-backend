import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthPlatformError, authErrorBody } from '../src/auth-v2/auth-errors';
import { isNewAuthEnabled } from '../src/auth-v2/auth-v2.flags';
import { EnvSecretsProvider } from '../src/auth-v2/secrets.provider';
import { SigningKeyService } from '../src/auth-v2/signing-key.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateEd25519PemPair,
  TokenService,
} from '../src/auth-v2/token.service';

function installCurrentKeys(kid = 'test-kid-1'): ReturnType<typeof generateEd25519PemPair> {
  const pair = generateEd25519PemPair();
  process.env.AUTH_ED25519_CURRENT_KID = kid;
  process.env.AUTH_ED25519_CURRENT_PRIVATE_PEM = pair.privatePem;
  process.env.AUTH_ED25519_CURRENT_PUBLIC_PEM = pair.publicPem;
  delete process.env.AUTH_ED25519_PREVIOUS_KID;
  delete process.env.AUTH_ED25519_PREVIOUS_PUBLIC_PEM;
  return pair;
}

function buildTokenService(): { tokens: TokenService; keys: SigningKeyService } {
  const secrets = new EnvSecretsProvider();
  const keys = new SigningKeyService(secrets);
  keys.clearCache();
  return { tokens: new TokenService(keys), keys };
}

test('USE_NEW_AUTH defaults to false', () => {
  delete process.env.USE_NEW_AUTH;
  assert.equal(isNewAuthEnabled(), false);
  process.env.USE_NEW_AUTH = 'true';
  assert.equal(isNewAuthEnabled(), true);
  delete process.env.USE_NEW_AUTH;
});

test('EnvSecretsProvider require throws when missing', () => {
  const secrets = new EnvSecretsProvider();
  delete process.env.AUTH_TEST_SECRET_X;
  assert.equal(secrets.get('AUTH_TEST_SECRET_X'), undefined);
  assert.throws(() => secrets.require('AUTH_TEST_SECRET_X'), /Missing required secret/);
});

test('AuthPlatformError maps AUTH_INVALID_TOKEN to 401 envelope', () => {
  const error = new AuthPlatformError('AUTH_INVALID_TOKEN', 'bad');
  assert.equal(error.httpStatus, 401);
  assert.deepEqual(authErrorBody(error), {
    success: false,
    error: { code: 'AUTH_INVALID_TOKEN', message: 'bad' },
  });
});

test('TokenService issues EdDSA access JWT with kid and verifies it', () => {
  installCurrentKeys('kid-current');
  const { tokens } = buildTokenService();
  const jwt = tokens.issueAccessToken({
    userId: 7n,
    sessionId: 'sess_1',
    sessionVersion: 3,
    permissionVersion: 1,
    amr: ['telegram'],
  });
  const [headerPart] = jwt.split('.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString()) as {
    alg: string; kid: string;
  };
  assert.equal(header.alg, 'EdDSA');
  assert.equal(header.kid, 'kid-current');

  const claims = tokens.verifyAccessToken(jwt);
  assert.equal(claims.sub, '7');
  assert.equal(claims.sid, 'sess_1');
  assert.equal(claims.sv, 3);
  assert.equal(claims.pv, 1);
  assert.equal(claims.typ, 'access');
  assert.equal(claims.iss, 'onix-api');
  assert.equal(claims.aud, 'onix-web');
  assert.ok(claims.exp - claims.iat === ACCESS_TOKEN_TTL_SECONDS
    || claims.exp - claims.iat === Number(process.env.AUTH_ACCESS_TTL_SECONDS ?? 900));
});

test('TokenService rejects tampered access token', () => {
  installCurrentKeys();
  const { tokens } = buildTokenService();
  const jwt = tokens.issueAccessToken({
    userId: 1n, sessionId: 's', sessionVersion: 0, permissionVersion: 0,
  });
  const parts = jwt.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
  payload.sv = 99;
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.throws(
    () => tokens.verifyAccessToken(parts.join('.')),
    (error: unknown) => error instanceof AuthPlatformError && error.code === 'AUTH_INVALID_TOKEN',
  );
});

test('TokenService rejects expired access token beyond skew', () => {
  installCurrentKeys();
  const { tokens } = buildTokenService();
  const jwt = tokens.issueAccessToken({
    userId: 1n, sessionId: 's', sessionVersion: 0, permissionVersion: 0, ttlSeconds: -120,
  });
  assert.throws(
    () => tokens.verifyAccessToken(jwt),
    (error: unknown) => error instanceof AuthPlatformError && error.code === 'AUTH_INVALID_TOKEN',
  );
});

test('TokenService verifies tokens signed by PREVIOUS kid after rotation', () => {
  const first = installCurrentKeys('kid-a');
  const { tokens, keys } = buildTokenService();
  const oldJwt = tokens.issueAccessToken({
    userId: 2n, sessionId: 's2', sessionVersion: 0, permissionVersion: 0,
  });

  const second = generateEd25519PemPair();
  process.env.AUTH_ED25519_PREVIOUS_KID = 'kid-a';
  process.env.AUTH_ED25519_PREVIOUS_PUBLIC_PEM = first.publicPem;
  process.env.AUTH_ED25519_CURRENT_KID = 'kid-b';
  process.env.AUTH_ED25519_CURRENT_PRIVATE_PEM = second.privatePem;
  process.env.AUTH_ED25519_CURRENT_PUBLIC_PEM = second.publicPem;
  keys.clearCache();

  const claims = tokens.verifyAccessToken(oldJwt);
  assert.equal(claims.sub, '2');

  const fresh = tokens.issueAccessToken({
    userId: 2n, sessionId: 's2', sessionVersion: 0, permissionVersion: 0,
  });
  const header = JSON.parse(Buffer.from(fresh.split('.')[0], 'base64url').toString()) as { kid: string };
  assert.equal(header.kid, 'kid-b');
});

test('TokenService issues opaque refresh tokens and stable SHA-256 hashes', () => {
  installCurrentKeys();
  const { tokens } = buildTokenService();
  const first = tokens.issueRefreshToken();
  const second = tokens.issueRefreshToken();
  assert.notEqual(first.token, second.token);
  assert.equal(first.hash, tokens.hashRefreshToken(first.token));
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(first.hash.length, 64);
});

test('SigningKeyService throws AUTH_MISCONFIGURED when keys absent', () => {
  delete process.env.AUTH_ED25519_CURRENT_KID;
  delete process.env.AUTH_ED25519_CURRENT_PRIVATE_PEM;
  delete process.env.AUTH_ED25519_CURRENT_PUBLIC_PEM;
  const { tokens, keys } = buildTokenService();
  keys.clearCache();
  assert.throws(
    () => tokens.issueAccessToken({
      userId: 1n, sessionId: 's', sessionVersion: 0, permissionVersion: 0,
    }),
    (error: unknown) => error instanceof AuthPlatformError && error.code === 'AUTH_MISCONFIGURED',
  );
});
