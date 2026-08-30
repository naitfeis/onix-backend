import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import {
  isRetryableTransactionConflict,
  withSerializableTransaction,
} from '../src/database/transaction-retry';
import { SellerAnalyticsService } from '../src/economy/analytics/seller-analytics.service';
import { IdempotencyService } from '../src/idempotency/idempotency.service';
import { WorkerRunnerService } from '../src/workers/worker-runner.service';
import { PaymentsService } from '../src/economy/payments/payments.service';
import { ManualPaymentProvider } from '../src/economy/payments/manual.provider';
import { AdminSecurityService } from '../src/admin/admin-security.service';
import { AdminPlaneController } from '../src/admin/admin.controller';

const repoFile = (path: string) => readFileSync(path, 'utf8');

test('transaction retry only retries serialization/deadlock conflicts', async () => {
  assert.equal(isRetryableTransactionConflict({ code: 'P2034' }), true);
  assert.equal(isRetryableTransactionConflict({ code: '40001' }), true);
  assert.equal(isRetryableTransactionConflict({ cause: { code: '40P01' } }), true);
  assert.equal(isRetryableTransactionConflict({ code: 'P2002' }), false);
  assert.equal(isRetryableTransactionConflict(new Error('business conflict')), false);

  let attempts = 0;
  const prisma = {
    $transaction: async (execute: (tx: Prisma.TransactionClient) => Promise<string>) => {
      attempts += 1;
      if (attempts < 3) throw { code: 'P2034' };
      return execute({} as Prisma.TransactionClient);
    },
  };
  const value = await withSerializableTransaction(prisma as never, async () => 'ok');
  assert.equal(value, 'ok');
  assert.equal(attempts, 3);
});

test('transaction retry does not rerun P2002 or business errors', async () => {
  for (const failure of [{ code: 'P2002' }, new Error('insufficient funds')]) {
    let attempts = 0;
    const prisma = {
      $transaction: async () => {
        attempts += 1;
        throw failure;
      },
    };
    await assert.rejects(() => withSerializableTransaction(prisma as never, async () => undefined));
    assert.equal(attempts, 1);
  }
});

test('top-up serialization retry calls the external provider exactly once', async () => {
  const previous = process.env.MANUAL_PAYMENTS_ENABLED;
  process.env.MANUAL_PAYMENTS_ENABLED = 'true';
  try {
    let providerCalls = 0;
    let transactionAttempts = 0;
    let stored: any = null;
    const claimedIntent = {
      id: 'intent-1',
      userId: 9n,
      wallet: 'MAIN' as const,
      provider: 'MANUAL' as const,
      amountCents: 500n,
      currency: 'RUB',
      status: 'CREATED',
      idempotencyKey: 'topup-1',
      providerRef: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      succeededAt: null,
    };
    const tx = {
      paymentIntent: {
        create: async () => ({ ...claimedIntent }),
      },
    };
    const prisma = {
      paymentIntent: {
        findUnique: async () => stored,
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          stored = { ...stored, ...data, updatedAt: new Date() };
          return { count: 1 };
        },
      },
      $transaction: async (execute: (client: typeof tx) => Promise<typeof claimedIntent>) => {
        transactionAttempts += 1;
        const result = await execute(tx);
        if (transactionAttempts === 1) throw { code: 'P2034' };
        stored = result;
        return result;
      },
    };
    const provider = {
      code: 'MANUAL' as const,
      createIntentIsIdempotent: true as const,
      createIntent: async () => {
        providerCalls += 1;
        return { providerRef: 'provider-1', status: 'PENDING' as const };
      },
      confirmIntent: async () => undefined,
    };
    const service = new PaymentsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      provider as never,
    );

    const result = await service.createManualTopUpForAdmin(
      9n,
      { wallet: 'MAIN', amountCents: 500, idempotencyKey: 'topup-1' },
    );

    assert.equal(result.id, 'intent-1');
    assert.equal(transactionAttempts, 2);
    assert.equal(providerCalls, 1);
  } finally {
    if (previous === undefined) delete process.env.MANUAL_PAYMENTS_ENABLED;
    else process.env.MANUAL_PAYMENTS_ENABLED = previous;
  }
});

test('two concurrent identical top-ups share one DB claim and one provider call', async () => {
  const previous = process.env.MANUAL_PAYMENTS_ENABLED;
  process.env.MANUAL_PAYMENTS_ENABLED = 'true';
  try {
    let stored: any = null;
    let providerCalls = 0;
    let releaseProvider!: () => void;
    let signalProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => { signalProviderStarted = resolve; });
    const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const tx = {
      paymentIntent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (stored) throw { code: 'P2002' };
          const now = new Date();
          stored = {
            id: 'intent-concurrent',
            ...data,
            providerRef: null,
            metadata: null,
            createdAt: now,
            updatedAt: now,
            succeededAt: null,
          };
          return stored;
        },
      },
    };
    const prisma = {
      paymentIntent: {
        findUnique: async () => stored,
        updateMany: async ({ where, data }: {
          where: { id: string; status: string; updatedAt: Date };
          data: Record<string, unknown>;
        }) => {
          if (
            !stored
            || stored.id !== where.id
            || stored.status !== where.status
            || stored.updatedAt.getTime() !== where.updatedAt.getTime()
          ) return { count: 0 };
          stored = { ...stored, ...data, updatedAt: new Date() };
          return { count: 1 };
        },
      },
      $transaction: async (execute: (client: typeof tx) => Promise<unknown>) => execute(tx),
    };
    const provider = {
      code: 'MANUAL' as const,
      createIntentIsIdempotent: true as const,
      createIntent: async () => {
        providerCalls += 1;
        signalProviderStarted();
        await providerGate;
        return { providerRef: 'provider-shared', status: 'PENDING' as const };
      },
      confirmIntent: async () => ({ status: 'SUCCEEDED' as const }),
    };
    const service = new PaymentsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      provider as never,
    );
    const input = {
      wallet: 'MAIN' as const,
      amountCents: 500,
      idempotencyKey: 'topup-concurrent',
    };

    const first = service.createManualTopUpForAdmin(9n, input);
    await providerStarted;
    const second = service.createManualTopUpForAdmin(9n, input);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(providerCalls, 1);
    releaseProvider();
    const [a, b] = await Promise.all([first, second]);

    assert.equal(providerCalls, 1);
    assert.equal(a.id, 'intent-concurrent');
    assert.equal(b.id, 'intent-concurrent');
    assert.equal(a.providerRef, 'provider-shared');
    assert.equal(b.providerRef, 'provider-shared');
  } finally {
    if (previous === undefined) delete process.env.MANUAL_PAYMENTS_ENABLED;
    else process.env.MANUAL_PAYMENTS_ENABLED = previous;
  }
});

test('stale CREATED top-up is recovered with the original provider idempotency key', async () => {
  const previous = process.env.MANUAL_PAYMENTS_ENABLED;
  process.env.MANUAL_PAYMENTS_ENABLED = 'true';
  try {
    let stored: any = {
      id: 'intent-stale',
      userId: 9n,
      wallet: 'MAIN',
      provider: 'MANUAL',
      amountCents: 500n,
      currency: 'RUB',
      status: 'CREATED',
      idempotencyKey: 'topup-stable-recovery',
      providerRef: null,
      metadata: null,
      createdAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
      succeededAt: null,
    };
    const tx = {
      paymentIntent: {
        create: async () => { throw { code: 'P2002' }; },
      },
    };
    const prisma = {
      paymentIntent: {
        findUnique: async () => stored,
        updateMany: async ({ where, data }: {
          where: { id: string; status: string; updatedAt: Date };
          data: Record<string, unknown>;
        }) => {
          if (
            stored.id !== where.id
            || stored.status !== where.status
            || stored.updatedAt.getTime() !== where.updatedAt.getTime()
          ) return { count: 0 };
          stored = { ...stored, ...data, updatedAt: data.updatedAt ?? new Date() };
          return { count: 1 };
        },
      },
      $transaction: async (execute: (client: typeof tx) => Promise<unknown>) => execute(tx),
    };
    const seenKeys: string[] = [];
    const provider = {
      code: 'MANUAL' as const,
      createIntentIsIdempotent: true as const,
      createIntent: async ({ idempotencyKey }: { idempotencyKey: string }) => {
        seenKeys.push(idempotencyKey);
        return { providerRef: 'provider-recovered', status: 'PENDING' as const };
      },
      confirmIntent: async () => ({ status: 'SUCCEEDED' as const }),
    };
    const service = new PaymentsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      provider as never,
    );

    const result = await service.createManualTopUpForAdmin(
      9n,
      {
        wallet: 'MAIN',
        amountCents: 500,
        idempotencyKey: 'topup-stable-recovery',
      },
    );

    assert.deepEqual(seenKeys, ['topup-stable-recovery']);
    assert.equal(result.status, 'PENDING');
    assert.equal(result.providerRef, 'provider-recovered');
  } finally {
    if (previous === undefined) delete process.env.MANUAL_PAYMENTS_ENABLED;
    else process.env.MANUAL_PAYMENTS_ENABLED = previous;
  }
});

test('manual provider derives a deterministic reference from idempotency key', async () => {
  const provider = new ManualPaymentProvider();
  const base = {
    userId: 1n,
    wallet: 'MAIN' as const,
    amountCents: 100n,
    idempotencyKey: 'stable-key',
  };
  const first = await provider.createIntent(base);
  const replay = await provider.createIntent(base);
  const other = await provider.createIntent({ ...base, idempotencyKey: 'other-key' });

  assert.equal(first.providerRef, replay.providerRef);
  assert.notEqual(first.providerRef, other.providerRef);
});

test('seller analytics uses bounded UTC aggregates and completedAt', async () => {
  let queryText = '';
  const upserts: unknown[] = [];
  const prisma = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      queryText = strings.join('?');
      return [{
        day: new Date('2026-08-24T00:00:00.000Z'),
        uniqueViews: 2,
        ordersCount: 3,
        completedCount: 1,
        revenueCents: 100n,
        profitCents: 95n,
        favoritesAdded: 4,
      }];
    },
    sellerAnalyticsDaily: {
      upsert: (args: unknown) => {
        upserts.push(args);
        return Promise.resolve();
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const service = new SellerAnalyticsService(prisma as never);
  await service.rollupRange(7n, new Date('2026-08-24T12:00:00Z'), new Date('2026-08-24T22:00:00Z'));

  assert.match(queryText, /generate_series/);
  assert.match(queryText, /"completedAt" AT TIME ZONE 'UTC'/);
  assert.match(queryText, /"completedAt" >=/);
  assert.doesNotMatch(queryText, /findMany/);
  assert.equal(upserts.length, 1);
});

test('retired-flow cleanup remains manual and analytics index is concurrent', () => {
  const expand = repoFile(
    'prisma/migrations/20260830130000_remove_seller_verification_ai_product_creation/migration.sql',
  );
  const contract = repoFile(
    'prisma/manual-post-rollout/20260830130000_retired_flows_contract.sql',
  );
  const analyticsIndex = repoFile(
    'prisma/migrations/20260830120000_seller_analytics_completed_index/migration.sql',
  );

  assert.doesNotMatch(expand, /\bDROP\s+(?:TABLE|TYPE)\b/i);
  assert.match(expand, /"trustDirty"\s*=\s*true/);
  assert.match(contract, /contract_backup_confirmed/);
  assert.match(contract, /expected_seller_verification_rows/);
  assert.match(contract, /expected_product_creation_rows/);
  assert.match(contract, /\bDROP TABLE\b/i);
  assert.match(analyticsIndex, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/i);
});

test('transactional idempotency commits mutation and replay record together', async () => {
  let row: {
    id: string;
    requestHash: string;
    responseCode: number | null;
    responseBody: unknown;
  } | null = null;
  const records = {
    findUnique: async () => row,
    create: async ({ data }: { data: { requestHash: string } }) => {
      row = { id: 'idem-1', requestHash: data.requestHash, responseCode: null, responseBody: null };
      return row;
    },
    update: async ({ data }: { data: { responseCode?: number; responseBody?: unknown } }) => {
      assert.ok(row);
      row = { ...row, ...data };
      return row;
    },
  };
  const tx = {
    $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
    idempotencyRecord: records,
  };
  const prisma = {
    $transaction: async (execute: (client: typeof tx) => Promise<unknown>) => execute(tx),
  };
  const service = new IdempotencyService(prisma as never, { inc: () => undefined } as never);
  let mutations = 0;
  const first = await service.runTransactional(
    'wallet.withdraw',
    'key-1',
    { amount: 100 },
    async () => ({ mutation: ++mutations }),
    { userId: 9n },
  );
  const replay = await service.runTransactional(
    'wallet.withdraw',
    'key-1',
    { amount: 100 },
    async () => ({ mutation: ++mutations }),
    { userId: 9n },
  );

  assert.equal(first.kind, 'fresh');
  assert.equal(replay.kind, 'replay');
  assert.equal(mutations, 1);
  assert.deepEqual(first.value, replay.value);
});

test('worker persistence failure does not change successful job outcome', async () => {
  let successfulMetrics = 0;
  let capturedErrors = 0;
  const prisma = {
    workerJobRun: {
      create: async () => ({ id: 'run-1' }),
      update: async () => { throw new Error('audit table unavailable'); },
    },
  };
  const metrics = {
    recordWorkerJob: (_name: string, processed: number, ok: boolean) => {
      if (processed === 4 && ok) successfulMetrics += 1;
    },
  };
  const errors = { capture: () => { capturedErrors += 1; } };
  const locks = {
    withLease: async (_name: string, _ttl: number, run: () => Promise<number>) => run(),
  };
  const runner = new WorkerRunnerService(
    prisma as never,
    metrics as never,
    errors as never,
    locks as never,
    ...Array(8).fill({}) as [never, never, never, never, never, never, never, never],
  );
  await (runner as unknown as {
    execute(job: { name: string; intervalMs: number; leaseTtlMs: number; run: () => Promise<number> }): Promise<void>;
  }).execute({
    name: 'test-job',
    intervalMs: 60_000,
    leaseTtlMs: 60_000,
    run: async () => 4,
  });

  assert.equal(successfulMetrics, 1);
  assert.equal(capturedErrors, 0);
});

test('numeric order investigation id reaches the database and malformed ids do not', async () => {
  const seen: bigint[] = [];
  const prisma = {
    order: {
      findUnique: async ({ where }: { where: { id: bigint } }) => {
        seen.push(where.id);
        return null;
      },
    },
  };
  const service = new AdminSecurityService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);

  assert.equal(await service.getOrderInvestigation('42'), null);
  assert.equal(await service.getOrderInvestigation('42x'), null);
  assert.deepEqual(seen, [42n]);
});

test('platform-status mutation is super-admin-only and rejects no-op transitions', async () => {
  const target = { id: 12n, onixId: '000012', platformStatus: 'USER' as const };
  const tx = {
    user: {
      update: async ({ data }: { data: { platformStatus: string } }) => ({
        ...target,
        platformStatus: data.platformStatus,
        isAdmin: false,
        isSupport: false,
      }),
    },
    adminActionLog: { create: async () => ({ id: 1n }) },
  };
  const prisma = {
    user: { findFirst: async () => target },
    $transaction: async (execute: (client: typeof tx) => Promise<unknown>) => execute(tx),
  };
  const service = new AdminSecurityService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);

  await assert.rejects(
    () => service.setUserStatus(
      { id: 2n, email: 'support@example.com', role: 'SUPPORT_ADMIN', sessionId: 's' },
      '12',
      'VIP',
    ),
    /SUPER_ADMIN/,
  );
  await assert.rejects(
    () => service.setUserStatus(
      { id: 1n, email: 'root@example.com', role: 'SUPER_ADMIN', sessionId: 's' },
      '12',
      'USER',
    ),
    /не разрешён/,
  );
  const result = await service.setUserStatus(
    { id: 1n, email: 'root@example.com', role: 'SUPER_ADMIN', sessionId: 's' },
    '12',
    'VIP',
  );
  assert.equal(result.status, 'VIP');
});

test('finance admins are excluded from order investigation routes', () => {
  const listRoles = Reflect.getMetadata('admin_roles', AdminPlaneController.prototype.orders) as string[];
  const detailRoles = Reflect.getMetadata('admin_roles', AdminPlaneController.prototype.order) as string[];
  assert.equal(listRoles.includes('FINANCE_ADMIN'), false);
  assert.equal(detailRoles.includes('FINANCE_ADMIN'), false);
  assert.equal(listRoles.includes('SUPPORT_ADMIN'), true);
  assert.equal(detailRoles.includes('SECURITY_ADMIN'), true);
});

for (const operation of ['refund', 'complete'] as const) {
  test(`successful admin ${operation} retains a pending audit when completion logging fails`, async () => {
    const events: string[] = [];
    let auditCreated: { data: { action: string; targetId: string } } | undefined;
    const prisma = {
      adminUser: { findUnique: async () => ({ telegramId: 99n }) },
      user: {
        findUnique: async () => ({
          id: 9n,
          telegramId: 99n,
          onixId: '000009',
          platformStatus: 'ADMIN',
        }),
      },
      adminActionLog: {
        create: async (args: { data: { action: string; targetId: string } }) => {
          events.push('audit-created');
          auditCreated = args;
          return { id: 77n };
        },
        update: async () => {
          events.push('audit-update-failed');
          throw new Error('audit completion unavailable');
        },
      },
    };
    const escrow = {
      refundByAdmin: async () => {
        events.push('escrow-mutated');
        return { status: 'REFUNDED' };
      },
      completeByAdmin: async () => {
        events.push('escrow-mutated');
        return { status: 'COMPLETED' };
      },
    };
    const service = new AdminSecurityService(
      prisma as never,
      {} as never,
      {} as never,
      escrow as never,
      {} as never,
      {} as never,
    );
    const actor = {
      id: 1n,
      email: 'root@example.com',
      role: 'SUPER_ADMIN' as const,
      sessionId: 's',
    };

    const result = operation === 'refund'
      ? await service.refundOrder(actor, '42', 'reviewed')
      : await service.completeOrder(actor, '42', 'reviewed');

    assert.ok(result);
    assert.equal(auditCreated?.data.targetId, '42');
    assert.equal(auditCreated?.data.action, `ADMIN_ORDER_${operation.toUpperCase()}_PENDING`);
    assert.deepEqual(events, ['audit-created', 'escrow-mutated', 'audit-update-failed']);
  });
}
