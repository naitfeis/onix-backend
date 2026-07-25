import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  ACCOUNT_SALE_PROTECTION_MESSAGE,
  allocateWithdraw,
  isAccountSaleSubcategory,
  isNewAccount,
  protectionUntil,
  sumOtherSaleWithdrawalsInWindow,
  type LedgerRowForProvenance,
} from '../src/economy/wallet/fund-provenance';
import { resolveCorrelationId } from '../src/economy/wallet/correlation-id';
import { WithdrawVelocityService } from '../src/economy/wallet/withdraw-velocity';

function row(
  partial: Partial<LedgerRowForProvenance> & Pick<LedgerRowForProvenance, 'type' | 'amountCents' | 'idempotencyKey'>,
): LedgerRowForProvenance {
  return {
    fundKind: 'SYSTEM',
    saleKind: null,
    createdAt: new Date('2026-07-20T00:00:00Z'),
    productSubcategory: null,
    ...partial,
  };
}

test('isAccountSaleSubcategory detects *_ACCOUNTS', () => {
  assert.equal(isAccountSaleSubcategory('STEAM_ACCOUNTS'), true);
  assert.equal(isAccountSaleSubcategory('STEAM_TOPUP'), false);
});

test('A: USER_OWNED deposit withdraw allowed for new account (allocation)', () => {
  const rows: LedgerRowForProvenance[] = [
    row({
      type: 'DEPOSIT',
      amountCents: 50_000n,
      fundKind: 'USER_OWNED',
      idempotencyKey: 'dep1',
    }),
  ];
  const { allocation } = allocateWithdraw(rows, 50_000n);
  assert.equal(allocation.owned, 50_000n);
  assert.equal(allocation.accountSale, 0n);
  assert.equal(allocation.otherSale, 0n);
});

test('B: ACCOUNT sale proceeds allocate to accountSale bucket', () => {
  const rows: LedgerRowForProvenance[] = [
    row({
      type: 'SALE_PAYOUT',
      amountCents: 2_000_000n,
      fundKind: 'SALE_PROCEEDS',
      saleKind: 'ACCOUNT',
      idempotencyKey: 'sale1',
    }),
  ];
  const { allocation } = allocateWithdraw(rows, 2_000_000n);
  assert.equal(allocation.accountSale, 2_000_000n);
  assert.equal(allocation.owned, 0n);
});

test('G: mixed funds — withdraw 500 from owned first, not ACCOUNT sale', () => {
  const rows: LedgerRowForProvenance[] = [
    row({
      type: 'DEPOSIT',
      amountCents: 50_000n,
      fundKind: 'USER_OWNED',
      idempotencyKey: 'dep',
    }),
    row({
      type: 'SALE_PAYOUT',
      amountCents: 2_000_000n,
      fundKind: 'SALE_PROCEEDS',
      saleKind: 'ACCOUNT',
      idempotencyKey: 'sale',
      createdAt: new Date('2026-07-20T01:00:00Z'),
    }),
  ];
  const { allocation } = allocateWithdraw(rows, 50_000n);
  assert.equal(allocation.owned, 50_000n);
  assert.equal(allocation.accountSale, 0n);
});

test('C/D: protectionUntil is accountCreatedAt + 7 days (not sale+24h)', () => {
  const created = new Date('2026-07-25T00:00:00Z');
  const until = protectionUntil(created, 7);
  assert.equal(until.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(isNewAccount(created, new Date('2026-07-26T00:00:00Z')), true);
  assert.equal(isNewAccount(created, new Date('2026-08-01T00:00:00Z')), false);
});

test('E: OTHER sale velocity counts only OTHER portions', () => {
  const base = new Date('2026-07-25T10:00:00Z');
  const rows: LedgerRowForProvenance[] = [
    row({
      type: 'SALE_PAYOUT',
      amountCents: 10_000_000n,
      fundKind: 'SALE_PROCEEDS',
      saleKind: 'OTHER',
      idempotencyKey: 'sale-o',
      createdAt: base,
    }),
    row({
      type: 'WITHDRAWAL',
      amountCents: -1_000_000n,
      idempotencyKey: 'wd1',
      createdAt: new Date(base.getTime() + 1000),
    }),
  ];
  const prior = sumOtherSaleWithdrawalsInWindow(rows, new Date(base.getTime() - 1000));
  assert.equal(prior.count, 1);
  assert.equal(prior.cents, 1_000_000n);
});

test('WithdrawVelocityService: ACCOUNT sale hard-blocks with user-facing message', async () => {
  process.env.WITHDRAW_VELOCITY_ENFORCE = 'true';
  const prisma = {
    $queryRaw: async () => [{ '?column?': 1 }],
    user: {
      findUniqueOrThrow: async () => ({ createdAt: new Date() }),
    },
    ledgerEntry: {
      findMany: async () => [{
        type: 'SALE_PAYOUT',
        amountCents: 2_000_000n,
        fundKind: 'SALE_PROCEEDS',
        saleKind: 'ACCOUNT',
        idempotencyKey: 'sale',
        createdAt: new Date(),
        orderId: null,
      }],
    },
    order: { findMany: async () => [] },
  };
  const svc = new WithdrawVelocityService(prisma as never);
  await assert.rejects(
    () => svc.assertAllowed({ userId: 1n, amountCents: 2_000_000n, lockUser: true }),
    (err: unknown) => err instanceof BadRequestException
      && (err as BadRequestException).message === ACCOUNT_SALE_PROTECTION_MESSAGE,
  );
});

test('WithdrawVelocityService: USER_OWNED withdraw allowed for new account', async () => {
  const prisma = {
    $queryRaw: async () => [{ '?column?': 1 }],
    user: {
      findUniqueOrThrow: async () => ({ createdAt: new Date() }),
    },
    ledgerEntry: {
      findMany: async () => [{
        type: 'DEPOSIT',
        amountCents: 50_000n,
        fundKind: 'USER_OWNED',
        saleKind: null,
        idempotencyKey: 'dep',
        createdAt: new Date(),
        orderId: null,
      }],
    },
    order: { findMany: async () => [] },
  };
  const svc = new WithdrawVelocityService(prisma as never);
  const result = await svc.assertAllowed({ userId: 1n, amountCents: 50_000n, lockUser: true });
  assert.equal(result.allocation.owned, 50_000n);
  assert.equal(result.allocation.accountSale, 0n);
});

test('H: OTHER velocity soft-allows when ENFORCE=false', async () => {
  const prev = process.env.WITHDRAW_VELOCITY_ENFORCE;
  process.env.WITHDRAW_VELOCITY_ENFORCE = 'false';
  process.env.WITHDRAW_VELOCITY_NEW_MAX_COUNT = '1';
  const prisma = {
    $queryRaw: async () => [{ '?column?': 1 }],
    user: {
      findUniqueOrThrow: async () => ({ createdAt: new Date() }),
    },
    ledgerEntry: {
      findMany: async () => [
        {
          type: 'SALE_PAYOUT',
          amountCents: 10_000_000n,
          fundKind: 'SALE_PROCEEDS',
          saleKind: 'OTHER',
          idempotencyKey: 'sale',
          createdAt: new Date(Date.now() - 60_000),
          orderId: null,
        },
        {
          type: 'WITHDRAWAL',
          amountCents: -100_000n,
          fundKind: 'SYSTEM',
          saleKind: null,
          idempotencyKey: 'wd1',
          createdAt: new Date(Date.now() - 30_000),
          orderId: null,
        },
      ],
    },
    order: { findMany: async () => [] },
  };
  const svc = new WithdrawVelocityService(prisma as never);
  const result = await svc.assertAllowed({ userId: 1n, amountCents: 100_000n, lockUser: true });
  assert.ok(result.allocation.otherSale > 0n);
  if (prev === undefined) delete process.env.WITHDRAW_VELOCITY_ENFORCE;
  else process.env.WITHDRAW_VELOCITY_ENFORCE = prev;
});

test('Yellow flag: ACCOUNT_SALE_FUNDS_UNDER_PROTECTION for new account with ACCOUNT proceeds', async () => {
  const created = new Date();
  const prisma = {
    user: {
      findUniqueOrThrow: async () => ({ createdAt: created }),
    },
    ledgerEntry: {
      findMany: async () => [{
        type: 'SALE_PAYOUT',
        amountCents: 2_000_000n,
        fundKind: 'SALE_PROCEEDS',
        saleKind: 'ACCOUNT',
        idempotencyKey: 'sale',
        createdAt: created,
        orderId: null,
      }],
    },
    order: { findMany: async () => [] },
  };
  const svc = new WithdrawVelocityService(prisma as never);
  const flag = await svc.resolveAccountSaleProtectionFlag(1n, prisma as never);
  assert.ok(flag);
  assert.equal(flag!.code, 'ACCOUNT_SALE_FUNDS_UNDER_PROTECTION');
  assert.equal(flag!.severity, 'YELLOW');
  assert.equal(flag!.restrictedAccountSaleCents, '2000000');
});

test('Yellow flag null when account age >= 7 days', async () => {
  const created = new Date(Date.now() - 10 * 86_400_000);
  const prisma = {
    user: {
      findUniqueOrThrow: async () => ({ createdAt: created }),
    },
    ledgerEntry: {
      findMany: async () => [{
        type: 'SALE_PAYOUT',
        amountCents: 2_000_000n,
        fundKind: 'SALE_PROCEEDS',
        saleKind: 'ACCOUNT',
        idempotencyKey: 'sale',
        createdAt: created,
        orderId: null,
      }],
    },
    order: { findMany: async () => [] },
  };
  const svc = new WithdrawVelocityService(prisma as never);
  const flag = await svc.resolveAccountSaleProtectionFlag(1n, prisma as never);
  assert.equal(flag, null);
});

test('resolveCorrelationId prefers X-Request-Id', () => {
  assert.equal(
    resolveCorrelationId({ headers: { 'x-request-id': 'abc' } } as never),
    'abc',
  );
});

test('BalanceService credit persists fundKind', async () => {
  const { BalanceService } = await import('../src/economy/wallet/balance.service');
  const created: Record<string, unknown>[] = [];
  const tx = {
    ledgerEntry: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 1n, ...data };
      },
    },
    user: { update: async () => ({ balanceCents: 500n }) },
  };
  const bal = new BalanceService();
  await bal.credit(tx as never, 1n, 500n, 'DEPOSIT', {
    idempotencyKey: 'd1',
    fundKind: 'USER_OWNED',
    source: 'PAYMENT_PROVIDER',
  });
  assert.equal(created[0]!.fundKind, 'USER_OWNED');
});
