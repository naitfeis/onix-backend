import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ConflictException } from '@nestjs/common';
import { reserveProductStock } from '../src/economy/wallet/product-stock';
import { PaymentIntentExpireJob } from '../src/workers/jobs/payment-intent-expire.job';
import { withSerializableTransaction } from '../src/database/transaction-retry';
import { lockProductForUpdate } from '../src/database/money-locks';

/**
 * Inventory and analytics races against a real, migrated PostgreSQL database.
 *
 * The money races live in ledger-chaos.e2e.test.ts; this file covers the two
 * invariants that audit asked to prove and nothing covered end-to-end:
 *   - no overselling under concurrent buyers of the last unit;
 *   - no lost or double-counted unique views under concurrent readers.
 *
 * Like the chaos drill it refuses to fall back to DATABASE_URL: pointing an
 * inventory drill at production would be worse than skipping it.
 */
const databaseUrl = process.env.INVENTORY_RACE_DATABASE_URL?.trim();
const dbTest = databaseUrl ? test : test.skip;

const CONCURRENCY = 40;

type Ctx = {
  prisma: PrismaClient;
  pool: Pool;
  ids: { users: bigint[]; products: string[]; intents: string[] };
};

let ctx: Ctx | null = null;

async function connect(): Promise<Ctx> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 60,
    ssl: databaseUrl?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  await prisma.$connect();
  return { prisma, pool, ids: { users: [], products: [], intents: [] } };
}

async function teardown(): Promise<void> {
  if (!ctx) return;
  const { users, products, intents } = ctx.ids;
  // Intents reference users, products cascade to view rows: order matters.
  if (intents.length) await ctx.prisma.paymentIntent.deleteMany({ where: { id: { in: intents } } }).catch(() => undefined);
  if (products.length) await ctx.prisma.product.deleteMany({ where: { id: { in: products } } }).catch(() => undefined);
  if (users.length) await ctx.prisma.user.deleteMany({ where: { id: { in: users } } }).catch(() => undefined);
  await ctx.prisma.$disconnect();
  await ctx.pool.end();
  ctx = null;
}

async function createUser(label: string): Promise<bigint> {
  const c = ctx!;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const user = await c.prisma.user.create({
    data: { onixId: `INV${suffix}`, displayName: `inventory race ${label}`, balanceCents: 1_000_000n },
  });
  c.ids.users.push(user.id);
  return user.id;
}

async function createProduct(sellerId: bigint, quantity: number): Promise<string> {
  const c = ctx!;
  const product = await c.prisma.product.create({
    data: {
      title: 'Inventory race lot',
      priceCents: 25_000n,
      category: 'CS2',
      quantity,
      status: 'ACTIVE',
      sellerId,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  c.ids.products.push(product.id);
  return product.id;
}

/**
 * One buyer attempt through the same code path checkout uses: Serializable
 * isolation, SELECT ... FOR UPDATE, then the guarded atomic decrement.
 */
type BuyOutcome =
  | { kind: 'reserved' }
  | { kind: 'conflict' }
  | { kind: 'error'; code: string; message: string };

async function attemptBuy(productId: string, quantity: number): Promise<BuyOutcome> {
  try {
    await withSerializableTransaction(ctx!.prisma, async (tx) => {
      await lockProductForUpdate(tx, productId);
      const product = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        select: { status: true, quantity: true },
      });
      if (product.status !== 'ACTIVE' || product.quantity < quantity) {
        throw new ConflictException('Товар уже зарезервирован.');
      }
      await reserveProductStock(tx, productId, quantity);
    });
    return { kind: 'reserved' };
  } catch (error) {
    if (error instanceof ConflictException) return { kind: 'conflict' };
    // Keep the real code/message: swallowing it into a bucket hides whether the
    // loser saw a clean 409 or a serialization failure that exhausted retries.
    const err = error as { code?: string; message?: string };
    return { kind: 'error', code: String(err?.code ?? 'unknown'), message: String(err?.message ?? '').slice(0, 160) };
  }
}

async function race<T>(count: number, fn: (index: number) => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: count }, (_, index) => fn(index)));
}

dbTest('last unit cannot be oversold by concurrent buyers', { timeout: 120_000 }, async () => {
  ctx = await connect();
  try {
    const sellerId = await createUser('seller');
    const productId = await createProduct(sellerId, 1);

    const outcomes = await race(CONCURRENCY, () => attemptBuy(productId, 1));
    const reserved = outcomes.filter((outcome) => outcome.kind === 'reserved').length;
    const conflicts = outcomes.filter((outcome) => outcome.kind === 'conflict').length;
    const errors = outcomes.filter((outcome) => outcome.kind === 'error') as
      Array<{ code: string; message: string }>;

    assert.equal(reserved, 1, `exactly one buyer wins the last unit (reserved=${reserved})`);
    assert.equal(
      errors.length,
      0,
      `losers must get a clean 409, not an error; got ${JSON.stringify(errors.slice(0, 3))}`,
    );
    assert.equal(reserved + conflicts, CONCURRENCY, 'every buyer got a definite outcome');

    const product = await ctx.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    assert.equal(product.quantity, 0, 'stock bottoms out at zero');
    assert.notEqual(product.status, 'ACTIVE', 'sold-out lot leaves the ACTIVE pool');
    assert.ok(
      ['SOLD_OUT', 'RESERVED'].includes(product.status),
      `status is a sold state, got ${product.status}`,
    );
    assert.ok(product.quantity >= 0, 'stock is never negative');
  } finally {
    await teardown();
  }
});

dbTest('multi-unit stock sells exactly its quantity and no more', { timeout: 120_000 }, async () => {
  ctx = await connect();
  try {
    const sellerId = await createUser('seller-multi');
    const productId = await createProduct(sellerId, 7);

    // 40 buyers x 2 units against 7 in stock: at most 3 winners, and the sum of
    // awarded units can never exceed what existed.
    const outcomes = await race(CONCURRENCY, () => attemptBuy(productId, 2));
    const winners = outcomes.filter((outcome) => outcome.kind === 'reserved').length;
    const failures = outcomes.filter((outcome) => outcome.kind === 'error') as
      Array<{ code: string; message: string }>;
    assert.equal(failures.length, 0, `no unexpected errors; got ${JSON.stringify(failures.slice(0, 3))}`);
    assert.ok(winners <= 3, `winners respect the stock ceiling, got ${winners}`);
    assert.ok(winners > 0, 'stock was not spuriously exhausted');

    const product = await ctx.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    assert.ok(product.quantity >= 0, `stock never negative, got ${product.quantity}`);
    assert.equal(product.quantity, 7 - winners * 2, 'every awarded unit is accounted for');
  } finally {
    await teardown();
  }
});

dbTest('two concurrent expiry workers release one reservation exactly once', { timeout: 120_000 }, async () => {
  ctx = await connect();
  try {
    const sellerId = await createUser('seller-release');
    const buyerId = await createUser('buyer-release');
    const productId = await createProduct(sellerId, 1);
    assert.equal((await attemptBuy(productId, 1)).kind, 'reserved', 'setup reserved the last unit');

    const afterBuy = await ctx.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    assert.equal(afterBuy.quantity, 0, 'stock is held at zero while checkout is pending');

    // One stale checkout intent, the shape payments.service writes at reservation time.
    const idempotencyKey = `inv-race-${randomUUID()}`;
    const intent = await ctx.prisma.paymentIntent.create({
      data: {
        userId: buyerId,
        wallet: 'MAIN',
        provider: 'MANUAL',
        amountCents: 25_000n,
        status: 'CREATED',
        idempotencyKey,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        metadata: {
          checkout: {
            productId,
            quantity: 1,
            purchaseIdempotencyKey: `pur-${randomUUID()}`,
            unitPriceCents: '25000',
            totalAmountCents: '25000',
            stockReserved: true,
            externalFeeCents: '0',
          },
        },
      },
    });
    ctx.ids.intents.push(intent.id);

    // The production release path: two independent workers pick up the same stale
    // intent concurrently. The intent row lock plus the stockReserved flag must make
    // exactly one of them give the unit back — a second release would mint stock.
    const jobs = [new PaymentIntentExpireJob(ctx.prisma as never), new PaymentIntentExpireJob(ctx.prisma as never)];
    const results = await Promise.all(jobs.map((job) => job.run(100)));

    const product = await ctx.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    assert.equal(product.quantity, 1, `reservation released exactly once, stock back to 1, got ${product.quantity}`);
    assert.equal(product.status, 'ACTIVE', 'lot is purchasable again');
    const reloaded = await ctx.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    assert.equal(reloaded.status, 'EXPIRED', 'stale intent expired');
    assert.ok(
      results.filter((count) => count > 0).length <= 1,
      `at most one worker claims the expiry, got ${JSON.stringify(results)}`,
    );
  } finally {
    await teardown();
  }
});

dbTest('concurrent favorite adds produce exactly one row and no 500', { timeout: 120_000 }, async () => {
  ctx = await connect();
  try {
    const sellerId = await createUser('seller-fav');
    const viewerId = await createUser('viewer-fav');
    const productId = await createProduct(sellerId, 3);

    // FavoritesService.favorite uses upsert on @@id([userId, productId]).
    // Under concurrency a non-atomic upsert surfaces as P2002 to the caller,
    // i.e. a double-click on "add to favorites" would show the user a 500.
    const outcomes = await race(CONCURRENCY, () =>
      ctx!.prisma.favorite
        .upsert({
          where: { userId_productId: { userId: viewerId, productId } },
          create: { userId: viewerId, productId },
          update: {},
        })
        .then(() => 'ok' as const)
        .catch((error) => ((error as { code?: string }).code === 'P2002' ? 'unique-violation' as const : 'error' as const)),
    );

    const violations = outcomes.filter((outcome) => outcome === 'unique-violation').length;
    const errors = outcomes.filter((outcome) => outcome === 'error').length;
    assert.equal(errors, 0, 'no unexpected failures');
    assert.equal(violations, 0, `concurrent adds must not leak a unique violation, got ${violations}`);

    const rows = await ctx.prisma.favorite.findMany({ where: { userId: viewerId, productId } });
    assert.equal(rows.length, 1, 'exactly one favorite row');
  } finally {
    await teardown();
  }
});
dbTest('concurrent identical views count once and never lose the row', { timeout: 120_000 }, async () => {
  ctx = await connect();
  try {
    const sellerId = await createUser('seller-views');
    const productId = await createProduct(sellerId, 5);
    const viewerId = await createUser('viewer');
    const viewerKey = `u:${viewerId.toString()}`;

    // Same viewer, N parallel requests: the unique (productId, viewerKey) index is
    // the only thing that can make this correct.
    const outcomes = await race(CONCURRENCY, () =>
      ctx!.prisma.productViewUnique
        .create({
          data: { productId, sellerId, viewerKey, viewerUserId: viewerId },
        })
        .then(() => 'inserted' as const)
        .catch((error) => {
          const code = (error as { code?: string }).code;
          return code === 'P2002' ? ('duplicate' as const) : ('error' as const);
        }),
    );

    assert.equal(outcomes.filter((outcome) => outcome === 'inserted').length, 1, 'exactly one view row');
    assert.equal(outcomes.filter((outcome) => outcome === 'duplicate').length, CONCURRENCY - 1, 'the rest dedupe');
    assert.equal(outcomes.filter((outcome) => outcome === 'error').length, 0, 'no unexpected failures');

    const rows = await ctx.prisma.productViewUnique.findMany({ where: { productId, viewerKey } });
    assert.equal(rows.length, 1, 'one unique-view row persisted');
  } finally {
    await teardown();
  }
});

dbTest('distinct viewers each count once — no lost increments under contention', { timeout: 120_000 }, async () => {
  ctx = await connect();
  try {
    const sellerId = await createUser('seller-many-viewers');
    const productId = await createProduct(sellerId, 5);
    const viewers = await race(25, (index) => createUser(`viewer-${index}`));

    // 25 distinct viewers, each firing twice in parallel: expect exactly 25 rows.
    await race(50, (index) => {
      const viewerId = viewers[index % viewers.length]!;
      return ctx!.prisma.productViewUnique
        .create({
          data: { productId, sellerId, viewerKey: `u:${viewerId.toString()}`, viewerUserId: viewerId },
        })
        .catch(() => undefined);
    });

    const rows = await ctx.prisma.productViewUnique.findMany({ where: { productId } });
    assert.equal(rows.length, 25, `every distinct viewer counted exactly once, got ${rows.length}`);
    const uniqueKeys = new Set(rows.map((row) => row.viewerKey));
    assert.equal(uniqueKeys.size, 25, 'no viewer counted twice');
  } finally {
    await teardown();
  }
});