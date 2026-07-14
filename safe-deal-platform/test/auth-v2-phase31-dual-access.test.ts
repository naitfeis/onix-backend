import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'node:crypto';
import type { Session, User } from '@prisma/client';
import { AuthGuard, AuthService } from '../src/auth.module';
import { isAcceptV2AccessEnabled, isNewAuthEnabled } from '../src/auth-v2/auth-v2.flags';
import { DualAccessService, peekJwtAlg } from '../src/auth-v2/dual-access.service';
import { EnvSecretsProvider } from '../src/auth-v2/secrets.provider';
import { SessionService } from '../src/auth-v2/session.service';
import { SigningKeyService } from '../src/auth-v2/signing-key.service';
import { generateEd25519PemPair, TokenService } from '../src/auth-v2/token.service';

function installKeys(kid = 'p31-kid'): void {
  const pair = generateEd25519PemPair();
  process.env.AUTH_ED25519_CURRENT_KID = kid;
  process.env.AUTH_ED25519_CURRENT_PRIVATE_PEM = pair.privatePem;
  process.env.AUTH_ED25519_CURRENT_PUBLIC_PEM = pair.publicPem;
}

function buildTokens(): TokenService {
  const keys = new SigningKeyService(new EnvSecretsProvider());
  keys.clearCache();
  return new TokenService(keys);
}

function baseUser(overrides: Partial<User> = {}): User {
  return {
    id: 7n,
    telegramId: 42n,
    onixId: 'ONIX-000007',
    telegramNick: 'u',
    firstName: 'A',
    lastName: null,
    languageCode: 'ru',
    displayName: 'A',
    avatarUrl: null,
    bio: null,
    balanceCents: 0n,
    ratingAverage: 0 as never,
    ratingCount: 0,
    completedSales: 0,
    sessionVersion: 0,
    permissionVersion: 0,
    securityScore: 0,
    securityScoreAt: null,
    lastSeenAt: new Date(),
    lastLoginAt: null,
    isAdmin: false,
    deletedAt: null,
    mergedIntoUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function activeSession(userId: bigint, id = 'sess_p31'): Session {
  const now = Date.now();
  return {
    id,
    userId,
    familyId: 'fam_1',
    refreshTokenHash: 'a'.repeat(64),
    previousRefreshHash: null,
    refreshGeneration: 1,
    lockVersion: 0,
    absoluteExpiresAt: new Date(now + 86_400_000),
    refreshExpiresAt: new Date(now + 3_600_000),
    lastSeenAt: new Date(now),
    rememberMe: false,
    trustedDeviceId: null,
    clientType: 'web',
    deviceName: null,
    browser: null,
    os: null,
    platform: null,
    timezone: null,
    language: null,
    userAgent: null,
    fingerprintHash: null,
    screenResolution: null,
    webglHash: null,
    canvasHash: null,
    ipAddress: null,
    asn: null,
    country: null,
    city: null,
    riskScore: 0,
    amr: ['telegram'],
    revokedAt: null,
    revokeReason: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  } as Session;
}

function guardContext(request: { headers: Record<string, string>; user?: unknown }) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

function issueLegacyHs256(userId: bigint, telegramId: bigint, secret: string, ttlSeconds = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    sub: userId.toString(),
    telegramId: telegramId.toString(),
    iss: 'onix-api',
    iat: now,
    exp: now + ttlSeconds,
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

test('AUTH_ACCEPT_V2_ACCESS defaults to false; USE_NEW_AUTH stays independent', () => {
  delete process.env.AUTH_ACCEPT_V2_ACCESS;
  delete process.env.USE_NEW_AUTH;
  assert.equal(isAcceptV2AccessEnabled(), false);
  assert.equal(isNewAuthEnabled(), false);

  process.env.AUTH_ACCEPT_V2_ACCESS = 'true';
  assert.equal(isAcceptV2AccessEnabled(), true);
  assert.equal(isNewAuthEnabled(), false);

  process.env.AUTH_ACCEPT_V2_ACCESS = '1';
  assert.equal(isAcceptV2AccessEnabled(), true);
  delete process.env.AUTH_ACCEPT_V2_ACCESS;
});

test('peekJwtAlg reads header without verifying signature', () => {
  assert.equal(peekJwtAlg('not-a-jwt'), null);
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'x' })).toString('base64url');
  assert.equal(peekJwtAlg(`${header}.payload.sig`), 'EdDSA');
});

test('AuthGuard: Legacy HS256 passes with AuthUser shape', async () => {
  delete process.env.AUTH_ACCEPT_V2_ACCESS;
  const secret = 'test-secret-that-is-at-least-32-characters';
  process.env.JWT_SECRET = secret;
  const verified = { id: 7n, telegramId: 42n, onixId: 'ONIX-000007', isAdmin: false };
  const jwt = issueLegacyHs256(7n, 42n, secret);

  const auth = {
    verifyToken: async (token: string) => {
      assert.equal(token, jwt);
      return verified;
    },
  } as unknown as AuthService;

  const dual = new DualAccessService(
    buildTokens(),
    { validateAccessClaims: async () => assert.fail('must not validate v2') } as never,
  );
  const request: { headers: Record<string, string>; user?: typeof verified } = {
    headers: { authorization: `Bearer ${jwt}` },
  };
  const guard = new AuthGuard(new Reflector(), auth, dual);
  assert.equal(await guard.canActivate(guardContext(request) as never), true);
  assert.deepEqual(request.user, verified);
});

test('AuthGuard: Legacy HS256 invalid → 401 UnauthorizedException', async () => {
  delete process.env.AUTH_ACCEPT_V2_ACCESS;
  const auth = {
    verifyToken: async () => {
      throw new UnauthorizedException('Сессия недействительна или истекла. Войдите снова.');
    },
  } as unknown as AuthService;
  const dual = new DualAccessService(buildTokens(), {} as never);
  const request = { headers: { authorization: 'Bearer bad.legacy.token' } };
  const guard = new AuthGuard(new Reflector(), auth, dual);
  await assert.rejects(
    () => guard.canActivate(guardContext(request) as never),
    UnauthorizedException,
  );
});

test('AuthGuard: AUTH_ACCEPT_V2_ACCESS=false rejects Ed25519', async () => {
  delete process.env.AUTH_ACCEPT_V2_ACCESS;
  installKeys();
  const tokens = buildTokens();
  const jwt = tokens.issueAccessToken({
    userId: 7n,
    sessionId: 'sess_p31',
    sessionVersion: 0,
    permissionVersion: 0,
  });

  let legacyCalled = false;
  const auth = {
    verifyToken: async () => {
      legacyCalled = true;
      return { id: 7n };
    },
  } as unknown as AuthService;
  const dual = new DualAccessService(tokens, {
    validateAccessClaims: async () => assert.fail('must not accept when flag off'),
  } as never);

  const guard = new AuthGuard(new Reflector(), auth, dual);
  await assert.rejects(
    () => guard.canActivate(guardContext({
      headers: { authorization: `Bearer ${jwt}` },
    }) as never),
    UnauthorizedException,
  );
  assert.equal(legacyCalled, false);
});

test('AuthGuard: Ed25519 passes when AUTH_ACCEPT_V2_ACCESS=true', async () => {
  process.env.AUTH_ACCEPT_V2_ACCESS = 'true';
  installKeys();
  const tokens = buildTokens();
  const user = baseUser();
  const session = activeSession(user.id);
  const jwt = tokens.issueAccessToken({
    userId: user.id,
    sessionId: session.id,
    sessionVersion: user.sessionVersion,
    permissionVersion: user.permissionVersion,
  });

  const prisma = {
    user: { findUnique: async () => user },
    session: { findUnique: async () => session },
  };
  const sessions = new SessionService(prisma as never, tokens);
  const dual = new DualAccessService(tokens, sessions);

  let legacyCalled = false;
  const auth = {
    verifyToken: async () => {
      legacyCalled = true;
      return { id: 99n };
    },
  } as unknown as AuthService;

  const request: { headers: Record<string, string>; user?: unknown } = {
    headers: { authorization: `Bearer ${jwt}` },
  };
  const guard = new AuthGuard(new Reflector(), auth, dual);
  assert.equal(await guard.canActivate(guardContext(request) as never), true);
  assert.equal(legacyCalled, false);
  assert.deepEqual(request.user, {
    id: 7n,
    telegramId: 42n,
    onixId: 'ONIX-000007',
    isAdmin: false,
  });
  delete process.env.AUTH_ACCEPT_V2_ACCESS;
});

test('AuthGuard: revoked session → 401', async () => {
  process.env.AUTH_ACCEPT_V2_ACCESS = 'true';
  installKeys();
  const tokens = buildTokens();
  const user = baseUser();
  const session = { ...activeSession(user.id), revokedAt: new Date() };
  const jwt = tokens.issueAccessToken({
    userId: user.id,
    sessionId: session.id,
    sessionVersion: 0,
    permissionVersion: 0,
  });
  const sessions = new SessionService({
    user: { findUnique: async () => user },
    session: { findUnique: async () => session },
  } as never, tokens);
  const dual = new DualAccessService(tokens, sessions);
  const guard = new AuthGuard(new Reflector(), { verifyToken: async () => assert.fail('no') } as never, dual);
  await assert.rejects(
    () => guard.canActivate(guardContext({
      headers: { authorization: `Bearer ${jwt}` },
    }) as never),
    UnauthorizedException,
  );
  delete process.env.AUTH_ACCEPT_V2_ACCESS;
});

test('AuthGuard: sessionVersion mismatch → 401', async () => {
  process.env.AUTH_ACCEPT_V2_ACCESS = 'true';
  installKeys();
  const tokens = buildTokens();
  const user = baseUser({ sessionVersion: 5 });
  const session = activeSession(user.id);
  const jwt = tokens.issueAccessToken({
    userId: user.id,
    sessionId: session.id,
    sessionVersion: 0,
    permissionVersion: 0,
  });
  const sessions = new SessionService({
    user: { findUnique: async () => user },
    session: { findUnique: async () => session },
  } as never, tokens);
  const dual = new DualAccessService(tokens, sessions);
  const guard = new AuthGuard(new Reflector(), { verifyToken: async () => assert.fail('no') } as never, dual);
  await assert.rejects(
    () => guard.canActivate(guardContext({
      headers: { authorization: `Bearer ${jwt}` },
    }) as never),
    UnauthorizedException,
  );
  delete process.env.AUTH_ACCEPT_V2_ACCESS;
});

test('AuthGuard: expired access token → 401', async () => {
  process.env.AUTH_ACCEPT_V2_ACCESS = 'true';
  installKeys();
  const tokens = buildTokens();
  const jwt = tokens.issueAccessToken({
    userId: 7n,
    sessionId: 'sess_p31',
    sessionVersion: 0,
    permissionVersion: 0,
    ttlSeconds: -120,
  });
  const dual = new DualAccessService(tokens, {
    validateAccessClaims: async () => assert.fail('expired must fail before session'),
  } as never);
  const guard = new AuthGuard(new Reflector(), { verifyToken: async () => assert.fail('no') } as never, dual);
  await assert.rejects(
    () => guard.canActivate(guardContext({
      headers: { authorization: `Bearer ${jwt}` },
    }) as never),
    UnauthorizedException,
  );
  delete process.env.AUTH_ACCEPT_V2_ACCESS;
});

test('DualAccessService maps Ed25519 claims to AuthUser without controller branching', async () => {
  process.env.AUTH_ACCEPT_V2_ACCESS = 'true';
  installKeys();
  const tokens = buildTokens();
  const user = baseUser({ isAdmin: true });
  const session = activeSession(user.id);
  const jwt = tokens.issueAccessToken({
    userId: user.id,
    sessionId: session.id,
    sessionVersion: 0,
    permissionVersion: 0,
  });
  const dual = new DualAccessService(
    tokens,
    new SessionService({
      user: { findUnique: async () => user },
      session: { findUnique: async () => session },
    } as never, tokens),
  );
  assert.equal(dual.isEdDsaAccessToken(jwt), true);
  assert.equal(dual.isAcceptEnabled(), true);
  const authUser = await dual.verifyEd25519AccessToken(jwt);
  assert.deepEqual(authUser, {
    id: 7n,
    telegramId: 42n,
    onixId: 'ONIX-000007',
    isAdmin: true,
  });
  delete process.env.AUTH_ACCEPT_V2_ACCESS;
});
