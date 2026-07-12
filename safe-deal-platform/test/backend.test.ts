import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'node:crypto';
import { AuthGuard, AuthService } from '../src/auth.module';
import { parseId } from '../src/common';
import { ledgerDto } from '../src/response';

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
  process.env.BOT_TOKEN = '123:test-token';
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
  const now = Math.floor(Date.now() / 1000);
  const user = encodeURIComponent(JSON.stringify({ id: 42, username: 'onix_user', first_name: 'Onix' }));
  const check = `auth_date=${now}\nuser=${decodeURIComponent(user)}`;
  const secret = createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  const persisted = {
    id: 7n, telegramId: 42n, onixId: 'ONIX-000007', telegramNick: 'onix_user',
    displayName: 'Onix', avatarUrl: null, deletedAt: null, isAdmin: false,
  };
  const prisma = {
    user: {
      findUnique: async () => persisted,
      update: async () => persisted,
    },
  };
  const auth = new AuthService(prisma as never);
  const result = await auth.miniApp(`auth_date=${now}&user=${user}&hash=${hash}`);
  assert.equal(result.tokenType, 'Bearer');
  assert.match(result.accessToken, /^[^.]+\.[^.]+\.[^.]+$/);
});

test('ledger response maps canonical entries without BigInt leakage', () => {
  assert.deepEqual(ledgerDto({
    id: 1n, type: 'PURCHASE_HOLD', amountCents: -1250n, createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }), {
    id: '1', type: 'PURCHASE_HOLD', amountCents: '-1250', status: 'COMPLETED',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});
