import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  resolveWithdrawVelocityLimits,
  withdrawVelocityEnforceEnabled,
  WithdrawVelocityService,
} from '../src/economy/wallet/withdraw-velocity';
import { resolveCorrelationId } from '../src/economy/wallet/correlation-id';

test('resolveCorrelationId mints opaque id without request', () => {
  const a = resolveCorrelationId();
  const b = resolveCorrelationId();
  assert.match(a, /^[a-f0-9]{24}$/);
  assert.notEqual(a, b);
});

test('resolveCorrelationId prefers X-Request-Id', () => {
  const id = resolveCorrelationId({
    headers: { 'x-request-id': 'abc123correlation' },
  } as never);
  assert.equal(id, 'abc123correlation');
});

test('resolveWithdrawVelocityLimits: new account within 7 days', () => {
  const created = new Date(Date.now() - 2 * 86_400_000);
  const limits = resolveWithdrawVelocityLimits(created);
  assert.equal(limits.tier, 'new');
  assert.equal(limits.maxCount, 1);
  assert.equal(limits.maxCents, 5_000_000n);
});

test('resolveWithdrawVelocityLimits: trusted after new-account window', () => {
  const created = new Date(Date.now() - 30 * 86_400_000);
  const limits = resolveWithdrawVelocityLimits(created);
  assert.equal(limits.tier, 'trusted');
  assert.equal(limits.maxCount, 5);
  assert.equal(limits.maxCents, 20_000_000n);
});

test('WithdrawVelocityService blocks second withdraw for new account', async () => {
  process.env.WITHDRAW_VELOCITY_ENFORCE = 'true';
  const prisma = {
    user: {
      findUniqueOrThrow: async () => ({ createdAt: new Date() }),
    },
    ledgerEntry: {
      findMany: async () => [{ amountCents: -1_000_000n }],
    },
  };
  const svc = new WithdrawVelocityService(prisma as never);
  await assert.rejects(
    () => svc.assertAllowed({ userId: 1n, amountCents: 100_000n }),
    (err: unknown) => err instanceof BadRequestException,
  );
});

test('WithdrawVelocityService allows under trusted limits', async () => {
  process.env.WITHDRAW_VELOCITY_ENFORCE = 'true';
  const prisma = {
    user: {
      findUniqueOrThrow: async () => ({
        createdAt: new Date(Date.now() - 40 * 86_400_000),
      }),
    },
    ledgerEntry: {
      findMany: async () => [{ amountCents: -1_000_000n }],
    },
  };
  const svc = new WithdrawVelocityService(prisma as never);
  const limits = await svc.assertAllowed({ userId: 1n, amountCents: 500_000n });
  assert.equal(limits.tier, 'trusted');
});

test('WITHDRAW_VELOCITY_ENFORCE=false soft-allows breach', async () => {
  const prev = process.env.WITHDRAW_VELOCITY_ENFORCE;
  process.env.WITHDRAW_VELOCITY_ENFORCE = 'false';
  assert.equal(withdrawVelocityEnforceEnabled(), false);
  const prisma = {
    user: {
      findUniqueOrThrow: async () => ({ createdAt: new Date() }),
    },
    ledgerEntry: {
      findMany: async () => [{ amountCents: -5_000_000n }],
    },
  };
  const svc = new WithdrawVelocityService(prisma as never);
  const limits = await svc.assertAllowed({ userId: 1n, amountCents: 100_000n });
  assert.equal(limits.tier, 'new');
  if (prev === undefined) delete process.env.WITHDRAW_VELOCITY_ENFORCE;
  else process.env.WITHDRAW_VELOCITY_ENFORCE = prev;
});

test('BalanceService credit persists actor/source/correlationId', async () => {
  const { BalanceService } = await import('../src/economy/wallet/balance.service');
  const created: Record<string, unknown>[] = [];
  const tx = {
    ledgerEntry: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 9n, ...data };
      },
    },
    user: {
      update: async () => ({ balanceCents: 1500n }),
    },
  };
  const bal = new BalanceService();
  await bal.credit(tx as never, 7n, 500n, 'DEPOSIT', {
    idempotencyKey: 'pay:test:main',
    actorUserId: 7n,
    source: 'PAYMENT_PROVIDER',
    correlationId: 'req-slice4',
  });
  assert.equal(created.length, 1);
  assert.equal(created[0]!.actorUserId, 7n);
  assert.equal(created[0]!.source, 'PAYMENT_PROVIDER');
  assert.equal(created[0]!.correlationId, 'req-slice4');
});
