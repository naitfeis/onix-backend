import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import type { Session, User } from '@prisma/client';
import { AuthService } from '../src/auth.module';
import { AuthOrchestrator } from '../src/auth-v2/auth-orchestrator.service';
import {
  isDualIssueRefreshCookieEnabled,
  isDualIssueSessionEnabled,
  isNewAuthEnabled,
} from '../src/auth-v2/auth-v2.flags';
import { AuthEventPublisher } from '../src/auth-v2/auth-events';
import { EnvSecretsProvider } from '../src/auth-v2/secrets.provider';
import { DeviceTrustService } from '../src/auth-v2/device-trust.service';
import { SessionService } from '../src/auth-v2/session.service';
import { SigningKeyService } from '../src/auth-v2/signing-key.service';
import { generateEd25519PemPair, TokenService } from '../src/auth-v2/token.service';
import { RiskEngineService } from '../src/risk/risk-engine.service';

function installKeys(): void {
  const pair = generateEd25519PemPair();
  process.env.AUTH_ED25519_CURRENT_KID = 'p32-kid';
  process.env.AUTH_ED25519_CURRENT_PRIVATE_PEM = pair.privatePem;
  process.env.AUTH_ED25519_CURRENT_PUBLIC_PEM = pair.publicPem;
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

type Store = {
  users: Map<string, User>;
  sessions: Map<string, Session>;
  audits: Array<Record<string, unknown>>;
};

function createSessionPrisma(store: Store) {
  return {
    user: {
      findUnique: async ({ where }: { where: { id: bigint } }) => store.users.get(String(where.id)) ?? null,
    },
    session: {
      create: async ({ data }: { data: Session }) => {
        store.sessions.set(data.id, { ...data });
        return store.sessions.get(data.id)!;
      },
      findMany: async ({ where }: { where: { userId: bigint; revokedAt?: null } }) => (
        [...store.sessions.values()]
          .filter((s) => {
            if (s.userId !== where.userId) return false;
            if (where.revokedAt === null && s.revokedAt != null) return false;
            return true;
          })
          .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
      ),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Session> }) => {
        const row = store.sessions.get(where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async () => ({ count: 0 }),
    },
    trustedDevice: {
      findFirst: async () => null,
      update: async () => null,
      updateMany: async () => ({ count: 0 }),
    },
    authAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.audits.push(data);
        return data;
      },
    },
    securityEvent: { create: async () => ({}) },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(createSessionPrisma(store)),
  };
}

function miniAppInitData(user: Record<string, unknown>): string {
  process.env.BOT_TOKEN = '123:test-token';
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

function buildOrchestrator(store: Store): AuthOrchestrator {
  installKeys();
  const keys = new SigningKeyService(new EnvSecretsProvider());
  keys.clearCache();
  const tokens = new TokenService(keys);
  const prisma = createSessionPrisma(store) as never;
  const sessions = new SessionService(prisma, tokens, new DeviceTrustService(), new RiskEngineService(prisma));
  return new AuthOrchestrator(
    prisma,
    {} as never,
    {} as never,
    sessions,
    new AuthEventPublisher(),
  );
}

test('AUTH_DUAL_ISSUE_SESSION defaults to false; cookie flag off; USE_NEW_AUTH independent', () => {
  delete process.env.AUTH_DUAL_ISSUE_SESSION;
  delete process.env.AUTH_DUAL_ISSUE_SET_COOKIE;
  delete process.env.USE_NEW_AUTH;
  assert.equal(isDualIssueSessionEnabled(), false);
  assert.equal(isDualIssueRefreshCookieEnabled(), false);
  assert.equal(isNewAuthEnabled(), false);

  process.env.AUTH_DUAL_ISSUE_SESSION = 'true';
  assert.equal(isDualIssueSessionEnabled(), true);
  assert.equal(isNewAuthEnabled(), false);
  delete process.env.AUTH_DUAL_ISSUE_SESSION;
});

test('dualIssueSessionAfterLegacyLogin no-ops when flag off', async () => {
  delete process.env.AUTH_DUAL_ISSUE_SESSION;
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    audits: [],
  };
  const orchestrator = buildOrchestrator(store);
  const result = await orchestrator.dualIssueSessionAfterLegacyLogin(7n, 'telegram-mini');
  assert.equal(result, null);
  assert.equal(store.sessions.size, 0);
  assert.equal(store.audits.length, 0);
});

test('dualIssueSessionAfterLegacyLogin creates Session + refresh hash + LOGIN_SUCCESS', async () => {
  process.env.AUTH_DUAL_ISSUE_SESSION = 'true';
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    audits: [],
  };
  const orchestrator = buildOrchestrator(store);
  const result = await orchestrator.dualIssueSessionAfterLegacyLogin(7n, 'telegram-mini');
  assert.ok(result);
  assert.equal(store.sessions.size, 1);
  const session = [...store.sessions.values()][0];
  assert.equal(session.userId, 7n);
  assert.equal(session.clientType, 'MINI_APP');
  assert.equal(session.refreshTokenHash.length, 64);
  assert.equal(session.revokedAt, null);
  assert.equal(result!.sessionId, session.id);
  assert.equal(result!.familyId, session.familyId);
  assert.equal(result!.refreshTokenIssued, true);
  assert.equal(store.audits.some((a) => a.action === 'LOGIN_SUCCESS'), true);
  assert.equal(store.audits.some((a) => a.provider === 'TELEGRAM'), true);
  delete process.env.AUTH_DUAL_ISSUE_SESSION;
});

test('dualIssueSessionAfterLegacyLogin uses TELEGRAM_WIDGET clientType for telegram-login', async () => {
  process.env.AUTH_DUAL_ISSUE_SESSION = 'true';
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    audits: [],
  };
  const orchestrator = buildOrchestrator(store);
  await orchestrator.dualIssueSessionAfterLegacyLogin(7n, 'telegram-login');
  assert.equal([...store.sessions.values()][0].clientType, 'TELEGRAM_WIDGET');
  delete process.env.AUTH_DUAL_ISSUE_SESSION;
});

test('dualIssueSessionAfterLegacyLogin fail-open on SessionService error', async () => {
  process.env.AUTH_DUAL_ISSUE_SESSION = 'true';
  installKeys();
  const keys = new SigningKeyService(new EnvSecretsProvider());
  keys.clearCache();
  const tokens = new TokenService(keys);
  const sessions = {
    createSession: async () => {
      throw new Error('boom');
    },
  } as unknown as SessionService;
  const orchestrator = new AuthOrchestrator(
    {} as never,
    {} as never,
    {} as never,
    sessions,
    new AuthEventPublisher(),
  );
  const result = await orchestrator.dualIssueSessionAfterLegacyLogin(7n, 'telegram-mini');
  assert.equal(result, null);
  delete process.env.AUTH_DUAL_ISSUE_SESSION;
});

test('AuthService miniApp response contract unchanged when dual-issue runs', async () => {
  process.env.AUTH_DUAL_ISSUE_SESSION = 'true';
  const persisted = {
    id: 7n, telegramId: 42n, onixId: 'ONIX-000007', telegramNick: 'onix_user',
    firstName: 'Onix', lastName: null, languageCode: 'ru', displayName: 'Onix',
    avatarUrl: null, deletedAt: null, isAdmin: false,
  };
  const prisma = {
    user: {
      findUnique: async () => persisted,
      update: async () => persisted,
    },
    identityLink: {
      findUnique: async () => null,
      upsert: async () => ({}),
    },
  };

  let dualCalled = false;
  const orchestrator = {
    dualIssueSessionAfterLegacyLogin: async (userId: bigint, source: string) => {
      dualCalled = true;
      assert.equal(userId, 7n);
      assert.equal(source, 'telegram-mini');
      return { sessionId: 's1', familyId: 'f1', refreshTokenIssued: true as const };
    },
  } as unknown as AuthOrchestrator;

  const auth = new AuthService(prisma as never, orchestrator);
  const result = await auth.miniApp(miniAppInitData({
    id: 42, username: 'onix_user', first_name: 'Onix', language_code: 'ru',
  }));

  assert.equal(dualCalled, true);
  assert.equal(result.tokenType, 'Bearer');
  assert.equal(result.expiresIn, '7d');
  assert.deepEqual(Object.keys(result).sort(), ['accessToken', 'expiresIn', 'tokenType', 'user']);
  const header = JSON.parse(Buffer.from(result.accessToken.split('.')[0], 'base64url').toString()) as {
    alg: string;
  };
  assert.equal(header.alg, 'HS256');
  assert.equal(result.user.id, '7');
  assert.equal(result.user.onixId, 'ONIX-000007');
  assert.equal('telegramId' in result.user, false);
  const jwtBody = JSON.parse(Buffer.from(result.accessToken.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
  assert.equal(jwtBody.sub, '7');
  assert.equal('telegramId' in jwtBody, false);
  delete process.env.AUTH_DUAL_ISSUE_SESSION;
});

test('AuthService miniApp does not call dual-issue when orchestrator absent (unit path)', async () => {
  delete process.env.AUTH_DUAL_ISSUE_SESSION;
  const persisted = {
    id: 7n, telegramId: 42n, onixId: 'ONIX-000007', telegramNick: 'onix_user',
    firstName: 'Onix', lastName: null, languageCode: 'ru', displayName: 'Onix',
    avatarUrl: null, deletedAt: null, isAdmin: false,
  };
  const prisma = {
    user: {
      findUnique: async () => persisted,
      update: async () => persisted,
    },
    identityLink: {
      findUnique: async () => null,
      upsert: async () => ({}),
    },
  };
  const auth = new AuthService(prisma as never);
  const result = await auth.miniApp(miniAppInitData({
    id: 42, username: 'onix_user', first_name: 'Onix', language_code: 'ru',
  }));
  assert.equal(result.tokenType, 'Bearer');
  assert.match(result.accessToken, /^[^.]+\.[^.]+\.[^.]+$/);
});

test('each dual-issue login creates a new Session (not a duplicate write of same row)', async () => {
  process.env.AUTH_DUAL_ISSUE_SESSION = 'true';
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    audits: [],
  };
  const orchestrator = buildOrchestrator(store);
  const a = await orchestrator.dualIssueSessionAfterLegacyLogin(7n, 'telegram-mini');
  const b = await orchestrator.dualIssueSessionAfterLegacyLogin(7n, 'telegram-mini');
  assert.ok(a && b);
  assert.notEqual(a!.sessionId, b!.sessionId);
  assert.equal(store.sessions.size, 2);
  delete process.env.AUTH_DUAL_ISSUE_SESSION;
});
