import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'node:crypto';
import { AuthGuard, AuthService } from '../src/auth.module';
import { AuthPlatformError } from '../src/auth-v2/auth-errors';
import { parseId } from '../src/common';
import {
  backfillTelegramIdentityLinks,
  dualWriteTelegramIdentity,
  isDualWriteIdentityEnabled,
  stableTelegramIdentityLinkId,
} from '../src/identity-link';
import { ledgerDto } from '../src/response';

function miniAppInitData(user: Record<string, unknown>): string {
  process.env.BOT_TOKEN = '123:test-token';
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
  delete process.env.AUTH_DUAL_WRITE_IDENTITY;
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

function identityLinkStore() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    api: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { provider_providerUserId: { provider: string; providerUserId: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = `${where.provider_providerUserId.provider}:${where.provider_providerUserId.providerUserId}`;
        const existing = rows.get(key);
        if (!existing) {
          rows.set(key, { ...create });
          return create;
        }
        const merged = { ...existing, ...Object.fromEntries(
          Object.entries(update).filter(([, value]) => value !== undefined),
        ) };
        rows.set(key, merged);
        return merged;
      },
      findUnique: async ({
        where,
      }: {
        where: { provider_providerUserId: { provider: string; providerUserId: string } };
      }) => {
        const key = `${where.provider_providerUserId.provider}:${where.provider_providerUserId.providerUserId}`;
        return rows.get(key) ?? null;
      },
    },
  };
}

test('parseId accepts decimal BigInt identifiers', () => {
  assert.equal(parseId('9223372036854775807'), 9223372036854775807n);
});

test('parseId rejects untrusted malformed identifiers', () => {
  assert.throws(() => parseId('1 OR 1=1'), BadRequestException);
});

test('AuthGuard rejects requests without a server session', async () => {
  const reflector = new Reflector();
  const auth = { verifyToken: async () => ({ id: 1n }) } as unknown as AuthService;
  const guard = new AuthGuard(reflector, auth);
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  };
  await assert.rejects(() => guard.canActivate(context as never), UnauthorizedException);
});

test('AuthGuard derives current user only from verified bearer token', async () => {
  const verified = { id: 7n, telegramId: 42n, onixId: 'ONIX-000007', isAdmin: false };
  const request: { headers: Record<string, string>; user?: typeof verified } = {
    headers: { authorization: 'Bearer signed-token' },
  };
  const auth = { verifyToken: async (token: string) => {
    assert.equal(token, 'signed-token');
    return verified;
  } } as unknown as AuthService;
  const guard = new AuthGuard(new Reflector(), auth);
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  };
  assert.equal(await guard.canActivate(context as never), true);
  assert.deepEqual(request.user, verified);
});

test('Mini App bootstrap verifies initData and returns Bearer JWT', async () => {
  const links = identityLinkStore();
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
    identityLink: links.api,
  };
  const auth = new AuthService(prisma as never);
  const result = await auth.miniApp(miniAppInitData({
    id: 42, username: 'onix_user', first_name: 'Onix', language_code: 'ru',
  }));
  assert.equal(result.tokenType, 'Bearer');
  assert.match(result.accessToken, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(links.rows.size, 1);
  assert.equal(links.rows.get('TELEGRAM:42')?.userId, 7n);
});

test('Mini App synchronizes changed Telegram profile fields without replacing displayName', async () => {
  const links = identityLinkStore();
  const persisted = {
    id: 7n, telegramId: 42n, onixId: 'ONIX-000007', telegramNick: 'onix_user',
    firstName: 'Onix', lastName: 'User', languageCode: 'en', displayName: 'Trusted Trader',
    avatarUrl: 'https://t.me/old.svg', deletedAt: null, isAdmin: false, isSupport: false,
  };
  let updateData: Record<string, unknown> = {};
  const prisma = {
    user: {
      findUnique: async () => persisted,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updateData = { ...updateData, ...data };
        return { ...persisted, ...data };
      },
    },
    identityLink: links.api,
  };

  await new AuthService(prisma as never).miniApp(miniAppInitData({
    id: 42, username: 'onix_user', first_name: 'Onix', last_name: 'User',
    language_code: 'ru', photo_url: 'https://t.me/new.svg',
  }));

  assert.equal(updateData.languageCode, 'ru');
  assert.equal(updateData.avatarUrl, 'https://t.me/new.svg');
  assert.ok(updateData.lastLoginAt instanceof Date);
  assert.ok(updateData.lastSeenAt instanceof Date);
  for (const unchanged of ['telegramNick', 'firstName', 'lastName', 'displayName']) {
    assert.equal(Object.hasOwn(updateData, unchanged), false);
  }
});

test('Mini App preserves optional profile data omitted by Telegram', async () => {
  const links = identityLinkStore();
  const persisted = {
    id: 7n, telegramId: 42n, onixId: 'ONIX-000007', telegramNick: 'onix_user',
    firstName: 'Onix', lastName: 'User', languageCode: 'ru', displayName: 'Trusted Trader',
    avatarUrl: 'https://t.me/avatar.svg', deletedAt: null, isAdmin: false,
  };
  let updateData: Record<string, unknown> | undefined;
  const prisma = {
    user: {
      findUnique: async () => persisted,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updateData = data;
        return { ...persisted, ...data };
      },
    },
    identityLink: links.api,
  };

  await new AuthService(prisma as never).miniApp(miniAppInitData({ id: 42 }));

  for (const omitted of ['telegramNick', 'firstName', 'lastName', 'languageCode', 'displayName', 'avatarUrl']) {
    assert.equal(Object.hasOwn(updateData ?? {}, omitted), false);
  }
});

test('Mini App does not synchronize a blocked user', async () => {
  let updateCalled = false;
  const prisma = {
    user: {
      findUnique: async () => ({
        id: 7n, telegramId: 42n, onixId: 'ONIX-000007', telegramNick: 'onix_user',
        firstName: 'Onix', lastName: null, languageCode: 'ru', displayName: 'Onix',
        avatarUrl: null, deletedAt: new Date(), isAdmin: false,
      }),
      update: async () => {
        updateCalled = true;
        throw new Error('Blocked users must not be updated');
      },
    },
    identityLink: identityLinkStore().api,
  };

  await assert.rejects(
    () => new AuthService(prisma as never).miniApp(miniAppInitData({ id: 42 })),
    (error: unknown) => error instanceof AuthPlatformError && error.code === 'AUTH_ACCOUNT_LOCKED',
  );
  assert.equal(updateCalled, false);
});

test('Mini App repeat login reuses the Telegram user', async () => {
  const links = identityLinkStore();
  let persisted: Record<string, unknown> | null = null;
  let createCount = 0;
  const finalUser = {
    id: 7n, telegramId: 42n, onixId: 'ONIX-000007', telegramNick: 'onix_user',
    firstName: 'Onix', lastName: null, languageCode: 'ru', displayName: 'Onix',
    avatarUrl: null, deletedAt: null, isAdmin: false,
  };
  const prisma = {
    user: {
      findUnique: async () => persisted,
      update: async () => finalUser,
    },
    identityLink: links.api,
    $transaction: async (callback: (tx: {
      user: {
        create: (args: unknown) => Promise<typeof finalUser>;
        update: (args: unknown) => Promise<typeof finalUser>;
      };
      identityLink: typeof links.api;
    }) => Promise<typeof finalUser>) => callback({
      user: {
        create: async () => {
          createCount += 1;
          persisted = finalUser;
          return finalUser;
        },
        update: async () => finalUser,
      },
      identityLink: links.api,
    }),
  };
  const auth = new AuthService(prisma as never);
  const initData = miniAppInitData({
    id: 42, username: 'onix_user', first_name: 'Onix', language_code: 'ru',
  });

  const first = await auth.miniApp(initData);
  const second = await auth.miniApp(initData);

  assert.equal(createCount, 1);
  assert.equal(first.user.onixId, second.user.onixId);
  assert.match(first.accessToken, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.match(second.accessToken, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(links.rows.size, 1);
});

test('Mini App recovers from a concurrent first-login conflict', async () => {
  const links = identityLinkStore();
  const persisted = {
    id: 7n, telegramId: 42n, onixId: 'ONIX-000007', telegramNick: 'onix_user',
    firstName: 'Onix', lastName: null, languageCode: 'ru', displayName: 'Onix',
    avatarUrl: null, deletedAt: null, isAdmin: false,
  };
  let findCount = 0;
  const prisma = {
    user: {
      findUnique: async () => {
        findCount += 1;
        return findCount === 1 ? null : persisted;
      },
      update: async () => persisted,
    },
    identityLink: links.api,
    $transaction: async () => {
      throw { code: 'P2002' };
    },
  };

  const result = await new AuthService(prisma as never).miniApp(miniAppInitData({
    id: 42, username: 'onix_user', first_name: 'Onix', language_code: 'ru',
  }));

  assert.equal(findCount, 2);
  assert.equal(result.user.onixId, 'ONIX-000007');
  assert.equal(links.rows.size, 1);
});

test('ledger response maps canonical entries without BigInt leakage', () => {
  assert.deepEqual(ledgerDto({
    id: 1n, type: 'PURCHASE_HOLD', amountCents: -1250n, createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }), {
    id: '1', type: 'PURCHASE_HOLD', amountCents: '-1250', status: 'COMPLETED',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});

test('P1: dual-write IdentityLink is idempotent for the same Telegram id', async () => {
  const links = identityLinkStore();
  const db = { identityLink: links.api } as never;
  await dualWriteTelegramIdentity(db, {
    userId: 7n, telegramId: 42n, username: 'onix_user', displayName: 'Onix',
  });
  await dualWriteTelegramIdentity(db, {
    userId: 7n, telegramId: 42n, username: 'onix_user', displayName: 'Onix',
  });
  assert.equal(links.rows.size, 1);
  assert.equal(links.rows.get('TELEGRAM:42')?.id, stableTelegramIdentityLinkId(7n, 42n));
});

test('P1: AUTH_DUAL_WRITE_IDENTITY=false skips IdentityLink writes', async () => {
  process.env.AUTH_DUAL_WRITE_IDENTITY = 'false';
  assert.equal(isDualWriteIdentityEnabled(), false);
  const links = identityLinkStore();
  await dualWriteTelegramIdentity({ identityLink: links.api } as never, {
    userId: 7n, telegramId: 42n,
  });
  assert.equal(links.rows.size, 0);
  delete process.env.AUTH_DUAL_WRITE_IDENTITY;
  assert.equal(isDualWriteIdentityEnabled(), true);
});

test('P1: backfill creates missing TELEGRAM links and is re-runnable', async () => {
  delete process.env.AUTH_DUAL_WRITE_IDENTITY;
  const links = identityLinkStore();
  const users = [
    {
      id: 1n, telegramId: 100n, telegramNick: 'a', displayName: 'A', avatarUrl: null,
    },
    {
      id: 2n, telegramId: 200n, telegramNick: 'b', displayName: 'B', avatarUrl: null,
    },
  ];
  const prisma = {
    user: {
      findMany: async () => users,
    },
    identityLink: links.api,
  };
  const first = await backfillTelegramIdentityLinks(prisma as never);
  const second = await backfillTelegramIdentityLinks(prisma as never);
  assert.equal(first.insertedOrUpdated, 2);
  assert.equal(second.insertedOrUpdated, 0);
  assert.equal(links.rows.size, 2);
});

test('P1: unique provider+providerUserId key is stable across users collision path', async () => {
  const links = identityLinkStore();
  await dualWriteTelegramIdentity({ identityLink: links.api } as never, {
    userId: 1n, telegramId: 42n,
  });
  await dualWriteTelegramIdentity({ identityLink: links.api } as never, {
    userId: 1n, telegramId: 42n,
  });
  assert.equal(links.rows.size, 1);
  assert.equal(links.rows.get('TELEGRAM:42')?.userId, 1n);
});
