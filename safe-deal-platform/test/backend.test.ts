import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'node:crypto';
import { AuthGuard, AuthService } from '../src/auth.module';
import { parseId } from '../src/common';
import { ledgerDto } from '../src/response';

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
  };
  const auth = new AuthService(prisma as never);
  const result = await auth.miniApp(miniAppInitData({
    id: 42, username: 'onix_user', first_name: 'Onix', language_code: 'ru',
  }));
  assert.equal(result.tokenType, 'Bearer');
  assert.match(result.accessToken, /^[^.]+\.[^.]+\.[^.]+$/);
});

test('Mini App updates only changed Telegram profile fields', async () => {
  const persisted = {
    id: 7n, telegramId: 42n, onixId: 'ONIX-000007', telegramNick: 'onix_user',
    firstName: 'Onix', lastName: 'User', languageCode: 'en', displayName: 'Trusted Trader',
    avatarUrl: 'https://t.me/old.svg', deletedAt: null, isAdmin: false,
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
  };

  await new AuthService(prisma as never).miniApp(miniAppInitData({
    id: 42,
    username: 'onix_user',
    first_name: 'Onix',
    last_name: 'User',
    language_code: 'ru',
    photo_url: 'https://t.me/new.svg',
  }));

  assert.equal(updateData?.languageCode, 'ru');
  assert.equal(updateData?.avatarUrl, 'https://t.me/new.svg');
  assert.ok(updateData?.lastLoginAt instanceof Date);
  assert.ok(updateData?.lastSeenAt instanceof Date);
  for (const unchanged of ['telegramNick', 'firstName', 'lastName', 'displayName']) {
    assert.equal(Object.hasOwn(updateData ?? {}, unchanged), false);
  }
});

test('Mini App preserves optional profile data omitted by Telegram', async () => {
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
  };

  await new AuthService(prisma as never).miniApp(miniAppInitData({ id: 42 }));

  for (const omitted of ['telegramNick', 'firstName', 'lastName', 'languageCode', 'displayName', 'avatarUrl']) {
    assert.equal(Object.hasOwn(updateData ?? {}, omitted), false);
  }
});

test('Mini App does not record a login for a blocked user', async () => {
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
  };

  await assert.rejects(
    () => new AuthService(prisma as never).miniApp(miniAppInitData({
      id: 42, username: 'onix_user', first_name: 'Onix', language_code: 'ru',
    })),
    UnauthorizedException,
  );
  assert.equal(updateCalled, false);
});

test('Mini App repeat login reuses the Telegram user', async () => {
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
    $transaction: async (callback: (tx: {
      user: {
        create: (args: unknown) => Promise<typeof finalUser>;
        update: (args: unknown) => Promise<typeof finalUser>;
      };
    }) => Promise<typeof finalUser>) => callback({
      user: {
        create: async () => {
          createCount += 1;
          persisted = finalUser;
          return finalUser;
        },
        update: async () => finalUser,
      },
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
});

test('Mini App retries profile synchronization after a concurrent first login', async () => {
  const persisted = {
    id: 7n, telegramId: 42n, onixId: 'ONIX-000007', telegramNick: 'onix_user',
    firstName: 'Onix', lastName: null, languageCode: 'ru', displayName: 'Onix',
    avatarUrl: null, deletedAt: null, isAdmin: false,
  };
  let findCount = 0;
  let updateCount = 0;
  const prisma = {
    user: {
      findUnique: async () => {
        findCount += 1;
        return findCount === 1 ? null : persisted;
      },
      update: async () => {
        updateCount += 1;
        return persisted;
      },
    },
    $transaction: async () => {
      throw { code: 'P2002' };
    },
  };

  const result = await new AuthService(prisma as never).miniApp(miniAppInitData({
    id: 42, username: 'onix_user', first_name: 'Onix', language_code: 'ru',
  }));

  assert.equal(findCount, 2);
  assert.equal(updateCount, 1);
  assert.equal(result.user.onixId, 'ONIX-000007');
});

test('ledger response maps canonical entries without BigInt leakage', () => {
  assert.deepEqual(ledgerDto({
    id: 1n, type: 'PURCHASE_HOLD', amountCents: -1250n, createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }), {
    id: '1', type: 'PURCHASE_HOLD', amountCents: '-1250', status: 'COMPLETED',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});
