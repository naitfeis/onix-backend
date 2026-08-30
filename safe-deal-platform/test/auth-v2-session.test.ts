import assert from 'node:assert/strict';
import test from 'node:test';
import type { Session, User } from '@prisma/client';
import { AuthPlatformError } from '../src/auth-v2/auth-errors';
import { EnvSecretsProvider } from '../src/auth-v2/secrets.provider';
import { MAX_SESSIONS_PER_USER } from '../src/auth-v2/session.constants';
import { SessionService } from '../src/auth-v2/session.service';
import { DeviceTrustService } from '../src/auth-v2/device-trust.service';
import { SigningKeyService } from '../src/auth-v2/signing-key.service';
import { generateEd25519PemPair, TokenService } from '../src/auth-v2/token.service';
import { RiskEngineService } from '../src/risk/risk-engine.service';
import { MemoryCoordinationAdapter } from '../src/coordination/memory-coordination.adapter';
import { SharedCoordinationService } from '../src/coordination/shared-coordination.service';

type Store = {
  users: Map<string, User>;
  sessions: Map<string, Session>;
  trusted: Map<string, {
    id: string; userId: bigint; fingerprintHash: string; revokedAt: Date | null;
    expiresAt: Date | null; lastSeenAt: Date;
  }>;
  audits: Array<Record<string, unknown>>;
  securityEvents: Array<Record<string, unknown>>;
};

function installKeys(): void {
  const pair = generateEd25519PemPair();
  process.env.AUTH_ED25519_CURRENT_KID = 'sess-kid';
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

function createPrismaMock(store: Store) {
  const api = {
    user: {
      findUnique: async ({ where }: { where: { id: bigint } }) => store.users.get(String(where.id)) ?? null,
      update: async ({ where, data }: {
        where: { id: bigint };
        data: { sessionVersion?: { increment: number } };
      }) => {
        const user = store.users.get(String(where.id));
        if (!user) throw new Error('user missing');
        if (data.sessionVersion?.increment) {
          user.sessionVersion += data.sessionVersion.increment;
        }
        store.users.set(String(where.id), user);
        return user;
      },
    },
    session: {
      create: async ({ data }: { data: Session }) => {
        store.sessions.set(data.id, { ...data });
        return store.sessions.get(data.id)!;
      },
      findUnique: async ({ where }: {
        where: { id?: string; refreshTokenHash?: string };
      }) => {
        if (where.id) return store.sessions.get(where.id) ?? null;
        if (where.refreshTokenHash) {
          return [...store.sessions.values()].find((s) => s.refreshTokenHash === where.refreshTokenHash) ?? null;
        }
        return null;
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = store.sessions.get(where.id);
        if (!row) throw new Error('not found');
        return row;
      },
      findFirst: async ({ where }: {
        where: { previousRefreshHash?: string };
      }) => [...store.sessions.values()].find((s) => s.previousRefreshHash === where.previousRefreshHash) ?? null,
      findMany: async ({ where, orderBy }: {
        where: { userId: bigint; revokedAt: null };
        orderBy?: { lastSeenAt: 'asc' | 'desc' };
      }) => {
        let rows = [...store.sessions.values()].filter((s) => {
          if (s.userId !== where.userId) return false;
          if (where.revokedAt === null && s.revokedAt != null) return false;
          return true;
        });
        if (orderBy?.lastSeenAt === 'asc') {
          rows = rows.sort((a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime());
        } else if (orderBy?.lastSeenAt === 'desc') {
          rows = rows.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
        }
        return rows;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Session> }) => {
        const row = store.sessions.get(where.id);
        if (!row) throw new Error('missing');
        const next = { ...row, ...data };
        store.sessions.set(where.id, next);
        return next;
      },
      updateMany: async ({ where, data }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const [id, row] of store.sessions) {
          let match = true;
          if (where.id !== undefined && row.id !== where.id) match = false;
          if (where.userId !== undefined && row.userId !== where.userId) match = false;
          if (where.familyId !== undefined && row.familyId !== where.familyId) match = false;
          if (where.refreshTokenHash !== undefined && row.refreshTokenHash !== where.refreshTokenHash) match = false;
          if (Object.prototype.hasOwnProperty.call(where, 'revokedAt') && where.revokedAt === null && row.revokedAt != null) {
            match = false;
          }
          if (!match) continue;

          const next: Session = { ...row };
          for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === 'object' && 'increment' in (value as object)) {
              const current = (next as unknown as Record<string, number>)[key] ?? 0;
              (next as unknown as Record<string, number>)[key] = current + (value as { increment: number }).increment;
            } else {
              (next as unknown as Record<string, unknown>)[key] = value;
            }
          }
          store.sessions.set(id, next);
          count += 1;
        }
        return { count };
      },
    },
    trustedDevice: {
      findFirst: async ({ where }: {
        where: {
          userId: bigint; fingerprintHash: string; revokedAt: null;
          OR: Array<{ expiresAt: null } | { expiresAt: { gt: Date } }>;
        };
      }) => {
        const now = new Date();
        return [...store.trusted.values()].find((t) => (
          t.userId === where.userId
          && t.fingerprintHash === where.fingerprintHash
          && t.revokedAt === null
          && (t.expiresAt === null || t.expiresAt > now)
        )) ?? null;
      },
      update: async ({ where, data }: { where: { id: string }; data: { lastSeenAt: Date } }) => {
        const row = store.trusted.get(where.id);
        if (!row) throw new Error('trusted missing');
        const next = { ...row, ...data };
        store.trusted.set(where.id, next);
        return next;
      },
      updateMany: async ({ where, data }: {
        where: { userId: bigint; fingerprintHash: string; revokedAt: null };
        data: { lastSeenAt: Date };
      }) => {
        let count = 0;
        for (const [id, row] of store.trusted) {
          if (row.userId === where.userId && row.fingerprintHash === where.fingerprintHash && row.revokedAt === null) {
            store.trusted.set(id, { ...row, ...data });
            count += 1;
          }
        }
        return { count };
      },
    },
    authAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.audits.push(data);
        return data;
      },
    },
    securityEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.securityEvents.push(data);
        return data;
      },
    },
    $transaction: async <T>(fn: (tx: typeof api) => Promise<T>): Promise<T> => fn(api),
  };
  return api;
}

function buildService(
  store: Store,
  adapter = new MemoryCoordinationAdapter(),
  instanceId = 'session-test',
): SessionService {
  installKeys();
  const keys = new SigningKeyService(new EnvSecretsProvider());
  keys.clearCache();
  const tokens = new TokenService(keys);
  const prisma = createPrismaMock(store) as never;
  const coordination = new SharedCoordinationService(
    adapter,
    { backend: 'memory', instanceId },
  );
  return new SessionService(prisma, tokens, new DeviceTrustService(), new RiskEngineService(prisma), coordination);
}

test('SessionService createSession stores refresh hash only and returns opaque token', async () => {
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    trusted: new Map(),
    audits: [],
    securityEvents: [],
  };
  const service = buildService(store);
  const result = await service.createSession({
    userId: 7n,
    device: { fingerprintHash: 'fp1', ipAddress: '1.1.1.1', browser: 'Chrome', os: 'Windows' },
  });

  assert.ok(result.refreshToken.length > 20);
  assert.equal(store.sessions.size, 1);
  const session = [...store.sessions.values()][0];
  assert.equal(session.refreshTokenHash.length, 64);
  assert.notEqual(session.refreshTokenHash, result.refreshToken);
  assert.equal(session.previousRefreshHash, null);
  assert.equal(session.rememberMe, false);
  assert.ok(result.accessToken.split('.').length === 3);
  assert.equal(store.audits.some((a) => a.action === 'LOGIN_SUCCESS'), true);
});

test('SessionService createSession marks TrustedDevice and lowers risk', async () => {
  process.env.DEVICE_HMAC_SECRET = 'test-device-secret';
  const trust = new DeviceTrustService();
  const device = {
    browser: 'chrome',
    os: 'windows',
    browserId: 'trusted-browser',
    timezone: 'UTC',
    language: 'en',
  };
  const deviceId = trust.resolveDeviceId(device);
  assert.ok(deviceId);

  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    trusted: new Map([['td1', {
      id: 'td1', userId: 7n, fingerprintHash: deviceId!, revokedAt: null, expiresAt: null, lastSeenAt: new Date(0),
    }]]),
    audits: [],
    securityEvents: [],
  };
  const service = buildService(store);
  const result = await service.createSession({
    userId: 7n,
    device: {
      ...device,
      fingerprintHash: 'client-should-be-ignored',
      canvasHash: 'nope',
    },
  });
  assert.equal(result.trustedDevice, true);
  assert.equal(result.session.riskScore, 5);
  assert.equal(result.session.fingerprintHash, deviceId);
  assert.equal(result.session.canvasHash, null);
  assert.equal(result.session.webglHash, null);
  assert.ok(store.trusted.get('td1')!.lastSeenAt.getTime() > 0);
});

test('SessionService rotateRefresh performs CAS rotation and keeps family id', async () => {
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    trusted: new Map(),
    audits: [],
    securityEvents: [],
  };
  const service = buildService(store);
  const created = await service.createSession({ userId: 7n });
  const familyId = created.session.familyId;
  const rotated = await service.rotateRefresh(created.refreshToken);

  assert.notEqual(rotated.refreshToken, created.refreshToken);
  assert.equal(rotated.session.familyId, familyId);
  assert.equal(rotated.session.refreshGeneration, 1);
  assert.equal(rotated.session.previousRefreshHash, created.session.refreshTokenHash);
  assert.equal(store.audits.filter((a) => a.action === 'REFRESH').length, 1);
});

test('SessionService concurrent previous-token refresh returns grace copy (no revoke)', async () => {
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    trusted: new Map(),
    audits: [],
    securityEvents: [],
  };
  const service = buildService(store);
  const created = await service.createSession({ userId: 7n });
  const oldRefresh = created.refreshToken;
  const first = await service.rotateRefresh(oldRefresh);
  const second = await service.rotateRefresh(oldRefresh);

  assert.equal(second.refreshToken, first.refreshToken);
  assert.equal(second.accessToken, first.accessToken);
  const session = [...store.sessions.values()][0];
  assert.equal(session.revokedAt, null);
  assert.equal(store.securityEvents.length, 0);
  assert.equal(store.users.get('7')!.sessionVersion, 0);
});

test('SessionService refresh grace is shared between instances', async () => {
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    trusted: new Map(),
    audits: [],
    securityEvents: [],
  };
  const adapter = new MemoryCoordinationAdapter();
  const firstInstance = buildService(store, adapter, 'one');
  const secondInstance = buildService(store, adapter, 'two');
  const created = await firstInstance.createSession({ userId: 7n });
  const first = await firstInstance.rotateRefresh(created.refreshToken);
  const second = await secondInstance.rotateRefresh(created.refreshToken);

  assert.equal(second.refreshToken, first.refreshToken);
  assert.equal(second.accessToken, first.accessToken);
  assert.equal(store.securityEvents.length, 0);
});

test('SessionService detects refresh reuse and revokes family with SecurityEvent', async () => {
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    trusted: new Map(),
    audits: [],
    securityEvents: [],
  };
  const service = buildService(store);
  const created = await service.createSession({ userId: 7n });
  const oldRefresh = created.refreshToken;
  await service.rotateRefresh(oldRefresh);
  // Outside grace (or other instance without shared cache) → real theft signal.
  await service.clearRotationGraceCache();

  await assert.rejects(
    () => service.rotateRefresh(oldRefresh),
    (error: unknown) => error instanceof AuthPlatformError && error.code === 'AUTH_REFRESH_REUSED',
  );

  const session = [...store.sessions.values()][0];
  assert.ok(session.revokedAt);
  assert.equal(session.revokeReason, 'REFRESH_REUSE');
  assert.equal(store.users.get('7')!.sessionVersion, 1);
  assert.equal(store.securityEvents[0]?.type, 'REFRESH_TOKEN_THEFT');
});

test('SessionService revokeAllSessions bumps sessionVersion and invalidates access', async () => {
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    trusted: new Map(),
    audits: [],
    securityEvents: [],
  };
  const service = buildService(store);
  const created = await service.createSession({ userId: 7n });
  const claims = new TokenService(new SigningKeyService(new EnvSecretsProvider())).verifyAccessToken(created.accessToken);

  const result = await service.revokeAllSessions(7n);
  assert.equal(result.revoked, 1);
  assert.equal(result.sessionVersion, 1);

  await assert.rejects(
    () => service.validateAccessClaims(claims),
    (error: unknown) => error instanceof AuthPlatformError && error.code === 'AUTH_INVALID_TOKEN',
  );
});

test('SessionService validateAccessClaims accepts live session with matching sv', async () => {
  const store: Store = {
    users: new Map([['7', baseUser({ sessionVersion: 2, permissionVersion: 4 })]]),
    sessions: new Map(),
    trusted: new Map(),
    audits: [],
    securityEvents: [],
  };
  const service = buildService(store);
  const created = await service.createSession({ userId: 7n });
  const keys = new SigningKeyService(new EnvSecretsProvider());
  keys.clearCache();
  const claims = new TokenService(keys).verifyAccessToken(created.accessToken);
  assert.equal(claims.sv, 2);
  const validated = await service.validateAccessClaims(claims);
  assert.equal(validated.session.id, created.session.id);
});

test('SessionService enforces max active sessions by revoking oldest', async () => {
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    trusted: new Map(),
    audits: [],
    securityEvents: [],
  };
  const service = buildService(store);
  const createdIds: string[] = [];
  for (let i = 0; i < MAX_SESSIONS_PER_USER; i += 1) {
    const created = await service.createSession({ userId: 7n });
    createdIds.push(created.session.id);
    // force older lastSeen for earlier sessions
    const row = store.sessions.get(created.session.id)!;
    row.lastSeenAt = new Date(Date.now() - (MAX_SESSIONS_PER_USER - i) * 1000);
  }
  const newest = await service.createSession({ userId: 7n });
  const active = await service.listSessions(7n);
  assert.equal(active.length, MAX_SESSIONS_PER_USER);
  assert.ok(active.some((s) => s.id === newest.session.id));
  assert.equal(store.sessions.get(createdIds[0])?.revokeReason, 'SESSION_LIMIT');
});

test('SessionService revokeSession writes LOGOUT audit', async () => {
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    trusted: new Map(),
    audits: [],
    securityEvents: [],
  };
  const service = buildService(store);
  const created = await service.createSession({ userId: 7n });
  await service.revokeSession(created.session.id, 'LOGOUT', 7n);
  assert.ok(store.sessions.get(created.session.id)?.revokedAt);
  assert.equal(store.audits.some((a) => a.action === 'LOGOUT'), true);
});

test('SessionService rejects rotate when absolute lifetime exceeded', async () => {
  const store: Store = {
    users: new Map([['7', baseUser()]]),
    sessions: new Map(),
    trusted: new Map(),
    audits: [],
    securityEvents: [],
  };
  const service = buildService(store);
  const created = await service.createSession({ userId: 7n });
  const session = store.sessions.get(created.session.id)!;
  session.absoluteExpiresAt = new Date(Date.now() - 1000);
  await assert.rejects(
    () => service.rotateRefresh(created.refreshToken),
    (error: unknown) => error instanceof AuthPlatformError && error.code === 'AUTH_SESSION_EXPIRED',
  );
});
