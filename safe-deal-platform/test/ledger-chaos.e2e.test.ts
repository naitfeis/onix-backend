import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { BalanceService } from '../src/economy/wallet/balance.service';
import { IdempotencyService } from '../src/idempotency/idempotency.service';
import { ManualPayoutProvider } from '../src/economy/payouts/manual-payout.provider';
import { PayoutProcessingJob } from '../src/workers/jobs/payout-processing.job';

/**
 * Destructive money-race drill against a dedicated, migrated PostgreSQL database.
 *
 * It deliberately does not fall back to DATABASE_URL: accidentally running a chaos
 * drill against production is worse than skipping it in an ordinary unit-test run.
 */
const databaseUrl = process.env.LEDGER_CHAOS_DATABASE_URL?.trim();
const dbTest = databaseUrl ? test : test.skip;

type Harness = {
  prisma: PrismaClient;
  pool: Pool;
  balance: BalanceService;
  idempotency: IdempotencyService;
};

async function harness(): Promise<Harness> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 30,
    ssl: databaseUrl?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  await prisma.$connect();
  const balance = new BalanceService();
  const metrics = { inc: () => undefined };
  const idempotency = new IdempotencyService(
    prisma as never,
    metrics as never,
  );
  return { prisma, pool, balance, idempotency };
}

async function createUser(prisma: PrismaClient, balanceCents: bigint) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  return prisma.user.create({
    data: { onixId: `CHAOS${suffix}`, displayName: 'Ledger chaos drill', balanceCents },
  });
}

async function close(h: Harness, userIds: bigint[]): Promise<void> {
  await h.prisma.idempotencyRecord.deleteMany({
    where: { route: { startsWith: 'chaos.' }, userId: { in: userIds } },
  }).catch(() => undefined);
  await h.prisma.payoutAttempt.deleteMany({ where: { payoutRequest: { userId: { in: userIds } } } }).catch(() => undefined);
  await h.prisma.payoutRequest.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
  await h.prisma.ledgerEntry.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
  await h.prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  await h.prisma.$disconnect();
  await h.pool.end();
}

dbTest('real DB: 20 duplicate purchase clicks produce one debit', async () => {
  const h = await harness();
  const user = await createUser(h.prisma, 100_000n);
  try {
    const key = `purchase-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      h.idempotency.runTransactional(
        'chaos.purchase',
        key,
        { amountCents: '25000' },
        async (tx) => {
          const entry = await h.balance.debit(tx, user.id, 25_000n, 'PURCHASE_HOLD', {
            idempotencyKey: `chaos:${key}:hold`,
            source: 'SYSTEM',
          });
          return { entryId: entry.id.toString() };
        },
        { userId: user.id },
      ),
    ));

    assert.equal(results.filter((result) => result.kind === 'fresh').length, 1);
    assert.equal(new Set(results.map((result) => result.value.entryId)).size, 1);
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.balanceCents, 75_000n);
    assert.equal(await h.prisma.ledgerEntry.count({
      where: { userId: user.id, type: 'PURCHASE_HOLD' },
    }), 1);
  } finally {
    await close(h, [user.id]);
  }
});

dbTest('real DB: duplicate withdrawal replay and concurrent overspend stay safe', async () => {
  const h = await harness();
  const user = await createUser(h.prisma, 50_000n);
  try {
    const replayKey = `withdraw-${randomUUID()}`;
    await Promise.all(Array.from({ length: 20 }, () =>
      h.idempotency.runTransactional(
        'chaos.withdraw',
        replayKey,
        { amountCents: '30000' },
        async (tx) => {
          const entry = await h.balance.debit(tx, user.id, 30_000n, 'WITHDRAWAL', {
            idempotencyKey: `chaos:${replayKey}:withdraw`,
            source: 'USER',
          });
          return { entryId: entry.id.toString() };
        },
        { userId: user.id },
      ),
    ));

    const attempts = await Promise.allSettled(['a', 'b'].map((suffix) =>
      h.prisma.$transaction(async (tx) =>
        h.balance.debit(tx, user.id, 20_000n, 'WITHDRAWAL', {
          idempotencyKey: `chaos:${replayKey}:${suffix}`,
          source: 'USER',
        }),
      ),
    ));
    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1);
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.balanceCents, 0n);
    assert.equal(await h.prisma.ledgerEntry.count({ where: { userId: user.id } }), 2);
  } finally {
    await close(h, [user.id]);
  }
});
dbTest('real DB: concurrent payout workers create at most one attempt and fail closed without a provider', async () => {
  const h = await harness();
  const user = await createUser(h.prisma, 0n);
  const previousAuto = process.env.PAYOUTS_AUTO_ENABLED;
  try {
    const suffix = randomUUID();
    const ledger = await h.prisma.ledgerEntry.create({
      data: {
        userId: user.id,
        type: 'WITHDRAWAL',
        amountCents: -1_000n,
        balanceAfterCents: 0n,
        idempotencyKey: `chaos:payout:ledger:${suffix}`,
        source: 'USER',
        fundKind: 'USER_OWNED',
      },
    });
    const payout = await h.prisma.payoutRequest.create({
      data: {
        userId: user.id,
        withdrawalLedgerEntryId: ledger.id,
        requestKey: `chaos:payout:request:${suffix}`,
        amountCents: 1_000n,
        status: 'APPROVED',
        provider: 'MANUAL',
      },
    });
    process.env.PAYOUTS_AUTO_ENABLED = 'true';
    const metrics = { gauge: () => undefined } as never;
    const alerts = { page: async () => undefined } as never;
    const job = new PayoutProcessingJob(
      h.prisma as never,
      new ManualPayoutProvider(),
      metrics,
      alerts,
    );

    await Promise.all([job.run(), job.run()]);

    assert.equal(await h.prisma.payoutAttempt.count({ where: { payoutRequestId: payout.id } }), 1);
    const current = await h.prisma.payoutRequest.findUniqueOrThrow({ where: { id: payout.id } });
    assert.equal(current.status, 'MANUAL_REVIEW');
    assert.equal(current.paidAt, null);
  } finally {
    if (previousAuto === undefined) delete process.env.PAYOUTS_AUTO_ENABLED;
    else process.env.PAYOUTS_AUTO_ENABLED = previousAuto;
    await close(h, [user.id]);
  }
});

dbTest('real DB: abort after balance mutation rolls the entire transaction back', async () => {
  const h = await harness();
  const user = await createUser(h.prisma, 40_000n);
  try {
    await assert.rejects(
      h.prisma.$transaction(async (tx) => {
        await h.balance.debit(tx, user.id, 15_000n, 'WITHDRAWAL', {
          idempotencyKey: `chaos:abort:${randomUUID()}`,
          source: 'USER',
        });
        throw new Error('simulated network/process interruption');
      }),
      /simulated network\/process interruption/,
    );
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.balanceCents, 40_000n);
    assert.equal(await h.prisma.ledgerEntry.count({ where: { userId: user.id } }), 0);
  } finally {
    await close(h, [user.id]);
  }
});

dbTest('real DB: parallel webhook deliveries credit exactly once', async () => {
  const h = await harness();
  const user = await createUser(h.prisma, 0n);
  try {
    const eventId = `tbank-${randomUUID()}`;
    const deliveries = await Promise.all(Array.from({ length: 20 }, () =>
      h.idempotency.runTransactional(
        'chaos.payment-webhook',
        eventId,
        { status: 'CONFIRMED', amount: '10000' },
        async (tx) => {
          const entry = await h.balance.credit(tx, user.id, 10_000n, 'DEPOSIT', {
            idempotencyKey: `chaos:payment:${eventId}`,
            source: 'PAYMENT_PROVIDER',
          });
          return { entryId: entry.id.toString() };
        },
        { userId: user.id },
      ),
    ));
    assert.equal(deliveries.filter((delivery) => delivery.kind === 'fresh').length, 1);
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.balanceCents, 10_000n);
    assert.equal(await h.prisma.ledgerEntry.count({ where: { userId: user.id } }), 1);
  } finally {
    await close(h, [user.id]);
  }
});

dbTest('real DB: competing complete/refund outcomes cannot both post money', async () => {
  const h = await harness();
  const seller = await createUser(h.prisma, 0n);
  const buyer = await createUser(h.prisma, 0n);
  try {
    const transitionKey = `order-transition-${randomUUID()}`;
    const outcomes = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      h.idempotency.runTransactional(
        'chaos.order-resolution',
        transitionKey,
        { orderId: transitionKey },
        async (tx) => {
          if (index % 2 === 0) {
            await h.balance.credit(tx, seller.id, 9_500n, 'SALE_PAYOUT', {
              idempotencyKey: `chaos:${transitionKey}:complete`,
              source: 'SYSTEM',
            });
            return { outcome: 'COMPLETED' };
          }
          await h.balance.credit(tx, buyer.id, 10_000n, 'REFUND', {
            idempotencyKey: `chaos:${transitionKey}:refund`,
            source: 'SYSTEM',
          });
          return { outcome: 'REFUNDED' };
        },
      ),
    ));
    assert.equal(new Set(outcomes.map((outcome) => outcome.value.outcome)).size, 1);
    const posted = await h.prisma.ledgerEntry.count({
      where: { userId: { in: [seller.id, buyer.id] } },
    });
    assert.equal(posted, 1);
  } finally {
    await close(h, [seller.id, buyer.id]);
  }
});
