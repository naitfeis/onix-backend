import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import { AuthOrchestrator } from '../src/auth-v2/auth-orchestrator.service';
import { AuthPlatformError } from '../src/auth-v2/auth-errors';
import { AuthEventPublisher } from '../src/auth-v2/auth-events';
import {
  assertCsrfHeader,
  buildClearRefreshCookieHeader,
  buildClearRefreshCookieHeaders,
  buildRefreshCookieHeader,
  readRefreshTokenFromCookie,
  refreshCookieName,
} from '../src/auth-v2/refresh-cookie';
import { TelegramLoginVerifier } from '../src/auth-v2/telegram-login.verifier';
import { EnvSecretsProvider } from '../src/auth-v2/secrets.provider';
import { SigningKeyService } from '../src/auth-v2/signing-key.service';
import { generateEd25519PemPair, TokenService } from '../src/auth-v2/token.service';
import { AuthV2Guard, PermissionGuard, RolesGuard } from '../src/auth-v2/auth-v2.guards';
import { Reflector } from '@nestjs/core';

function telegramLoginPayload(overrides: Record<string, string | number> = {}) {
  process.env.BOT_TOKEN = '123:test-token';
  const body = {
    id: '42',
    first_name: 'Onix',
    auth_date: Math.floor(Date.now() / 1000),
    username: 'onix_user',
    ...overrides,
  };
  const { hash: _h, ...data } = body as typeof body & { hash?: string };
  void _h;
  const check = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const hash = createHmac('sha256', createHash('sha256').update(process.env.BOT_TOKEN).digest())
    .update(check)
    .digest('hex');
  return { ...data, hash };
}

test('TelegramLoginVerifier accepts valid widget payload', () => {
  const verifier = new TelegramLoginVerifier();
  const identity = verifier.verify(telegramLoginPayload());
  assert.equal(identity.telegramId, 42n);
  assert.equal(identity.firstName, 'Onix');
});

test('TelegramLoginVerifier accepts valid Mini App initData', () => {
  process.env.BOT_TOKEN = '123:test-token';
  const user = JSON.stringify({ id: 42, first_name: 'Onix', username: 'onix_user' });
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAE',
    user,
  };
  const check = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  const initData = new URLSearchParams({ ...fields, hash }).toString();
  const identity = new TelegramLoginVerifier().verifyWebAppInitData(initData);
  assert.equal(identity.telegramId, 42n);
  assert.equal(identity.firstName, 'Onix');
  assert.equal(identity.username, 'onix_user');
});

test('TelegramLoginVerifier rejects bad hash with AUTH_PROVIDER_REJECTED', () => {
  const verifier = new TelegramLoginVerifier();
  const valid = telegramLoginPayload();
  assert.throws(
    () => verifier.verify({ ...valid, hash: 'a'.repeat(64) }),
    (error: unknown) => error instanceof AuthPlatformError && error.code === 'AUTH_PROVIDER_REJECTED',
  );
});

test('refresh cookie helpers use HttpOnly SameSite and readable parse', () => {
  process.env.AUTH_COOKIE_SECURE = 'false';
  assert.equal(refreshCookieName(), 'onix_rt');
  const header = buildRefreshCookieHeader('secret-token', 3600);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
  assert.equal(readRefreshTokenFromCookie(`foo=1; ${header.split(';')[0]}`), 'secret-token');
  assert.match(buildClearRefreshCookieHeader(), /Max-Age=0/);
  assert.match(buildClearRefreshCookieHeader(), /Expires=/);
  const cleared = buildClearRefreshCookieHeaders();
  assert.ok(cleared.some((row) => row.startsWith('__Host-onix_rt=')));
  assert.ok(cleared.some((row) => row.startsWith('onix_rt=')));
  delete process.env.AUTH_COOKIE_SECURE;
});

test('assertCsrfHeader requires X-ONIX-CSRF=1', () => {
  assert.throws(
    () => assertCsrfHeader({}),
    (error: unknown) => error instanceof AuthPlatformError && error.code === 'AUTH_CSRF_REJECTED',
  );
  assertCsrfHeader({ 'x-onix-csrf': '1' });
});

test('AuthEventPublisher delivers versioned events', async () => {
  const bus = new AuthEventPublisher();
  const seen: string[] = [];
  bus.subscribe((event) => { seen.push(event.name); });
  await bus.publish('UserLoggedIn.v1', { userId: '1' });
  assert.deepEqual(seen, ['UserLoggedIn.v1']);
});

test('PermissionGuard and RolesGuard enforce metadata', () => {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === 'auth_v2_permissions') return ['auth.sessions.revoke_any'];
      if (key === 'auth_v2_roles') return ['ADMIN'];
      return undefined;
    },
  } as unknown as Reflector;

  const permissionGuard = new PermissionGuard(reflector);
  const rolesGuard = new RolesGuard(reflector);
  const denied = {
    switchToHttp: () => ({
      getRequest: () => ({ user: { permissions: [], roles: [], isAdmin: false } }),
    }),
    getHandler: () => function handler() {},
    getClass: () => class C {},
  };
  assert.throws(() => permissionGuard.canActivate(denied as never), AuthPlatformError);
  assert.throws(() => rolesGuard.canActivate(denied as never), AuthPlatformError);

  const allowed = {
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          permissions: ['auth.sessions.revoke_any'],
          roles: ['ADMIN'],
          isAdmin: false,
        },
      }),
    }),
    getHandler: () => function handler() {},
    getClass: () => class C {},
  };
  assert.equal(permissionGuard.canActivate(allowed as never), true);
  assert.equal(rolesGuard.canActivate(allowed as never), true);
});

test('AuthV2Guard rejects missing bearer', async () => {
  const pair = generateEd25519PemPair();
  process.env.AUTH_ED25519_CURRENT_KID = 'k';
  process.env.AUTH_ED25519_CURRENT_PRIVATE_PEM = pair.privatePem;
  process.env.AUTH_ED25519_CURRENT_PUBLIC_PEM = pair.publicPem;
  const keys = new SigningKeyService(new EnvSecretsProvider());
  keys.clearCache();
  const tokens = new TokenService(keys);
  const guard = new AuthV2Guard(tokens, {
    validateAccessClaims: async () => ({ user: {}, session: {} }),
  } as never, {
    resolveForUser: async () => ({ permissions: [], roles: [] }),
  } as never);

  await assert.rejects(
    () => guard.canActivate({
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => function handler() {},
      getClass: () => class C {},
    } as never),
    AuthPlatformError,
  );
});

test('AuthOrchestrator login fails closed when BOT_TOKEN missing', async () => {
  delete process.env.BOT_TOKEN;
  const orchestrator = new AuthOrchestrator(
    { $transaction: async () => assert.fail('should not TX') } as never,
    new TelegramLoginVerifier(),
    {} as never,
    {} as never,
    new AuthEventPublisher(),
  );
  await assert.rejects(
    () => orchestrator.loginWithTelegram({
      telegram: {
        id: '1', first_name: 'A', auth_date: Math.floor(Date.now() / 1000), hash: 'a'.repeat(64),
      },
    }),
    (error: unknown) => error instanceof AuthPlatformError
      && (error.code === 'AUTH_MISCONFIGURED' || error.code === 'AUTH_PROVIDER_REJECTED'),
  );
});
