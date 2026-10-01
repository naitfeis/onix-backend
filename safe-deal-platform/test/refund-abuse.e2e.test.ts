import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { EscrowService } from '../src/escrow.module';
import { BalanceService } from '../src/economy/wallet/balance.service';
import { ClawbackService } from '../src/economy/wallet/clawback.service';
import type { AuthUser } from '../src/common';
import { ensurePairChat } from '../src/chat-pair';

/**
 * Attack drill: a buyer tries to take the auto-delivered secret AND refund themselves.
 *
 * The exploit that motivated the fix: POST /orders/:id/refund-request maps to
 * EscrowService.refundBySeller, and refund() only tested the actor when
 * `sellerInitiated` was true. Because sellerInitiated was computed as
 * `Boolean(opts?.sellerInitiated) && order.sellerId === actor.id`, a BUYER calling it
 * silently downgraded the flag to false, skipped the actor test entirely, and
 * REFUND_FROM includes DELIVERING — exactly where auto-delivery leaves an order after
 * handing over the secret. Result: goods kept, money returned, repeatable.
 *
 * Refuses to fall back to DATABASE_URL, like every other drill here.
 */
const databaseUrl = process.env.FRAUD_LIFECYCLE_DATABASE_URL?.trim();
const dbTest = databaseUrl ? test : test.skip;

const LOT_CENTS = 50_000n;
const FEE_CENTS = 2_500n;
const PAYOUT_CENTS = LOT_CENTS - FEE_CENTS;

type Harness = {
  prisma: PrismaClient;
  pool: Pool;
  userIds: bigint[];
  productIds: string[];
  orderIds: bigint[];
};

async function harness(): Promise<Harness> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    ssl: databaseUrl?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  await prisma.$connect();
  return { prisma, pool, userIds: [], productIds: [], orderIds: [] };
}

async function close(h: Harness): Promise<void> {
  await h.prisma.orderClawback.deleteMany({ where: { sellerId: { in: h.userIds } } }).catch(() => undefined);
  if (h.orderIds.length) {
    await h.prisma.orderTransition.deleteMany({ where: { orderId: { in: h.orderIds } } }).catch(() => undefined);
    await h.prisma.order.deleteMany({ where: { id: { in: h.orderIds } } }).catch(() => undefined);
  }
  if (h.productIds.length) {
    await h.prisma.product.deleteMany({ where: { id: { in: h.productIds } } }).catch(() => undefined);
  }
  if (h.userIds.length) {
    await h.prisma.message.deleteMany({
      where: { chat: { members: { some: { userId: { in: h.userIds } } } } },
    }).catch(() => undefined);
    await h.prisma.chatMember.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.chat.deleteMany({
      where: { members: { some: { userId: { in: h.userIds } } } },
    }).catch(() => undefined);
    await h.prisma.ledgerEntry.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.notification.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.auditLog.deleteMany({ where: { actorId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.securityEvent.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.user.deleteMany({ where: { id: { in: h.userIds } } }).catch(() => undefined);
  }
  await h.prisma.$disconnect();
  await h.pool.end();
}

async function makeUser(h: Harness, label: string, balanceCents: bigint): Promise<bigint> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const digits = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await h.prisma.user.create({
    data: {
      onixId: `ATK${suffix}`,
      displayName: `attack drill ${label}`,
      balanceCents,
      telegramId: BigInt(`8${digits}`),
    },
  });
  h.userIds.push(user.id);
  return user.id;
}

function actor(userId: bigint): AuthUser {
  return { id: userId, telegramId: null, onixId: 'ATK-000000', isAdmin: false, isSupport: false };
}

function escrow(h: Harness): EscrowService {
  const balance = new BalanceService();
  const clawbacks = new ClawbackService(balance);
  // Only the escrow money path matters here: locks/realtime/support are no-op stubs.
  const locks = { releaseForOrder: async () => undefined } as never;
  const realtime = { publish: () => undefined } as never;
  const support = { open: async () => undefined } as never;
  return new EscrowService(h.prisma as never, balance, clawbacks, locks, realtime, support);
}

/** Status code of a rejection, or 'resolved' when the call unexpectedly succeeded. */
async function attempt(promise: Promise<unknown>): Promise<string | number> {
  return promise.then(
    () => 'resolved',
    (error: unknown) => (error as { status?: number }).status ?? 'blocked',
  );
}

/**
 * An order in the exact state auto-delivery produces: buyer's money held in escrow,
 * secret handed over in chat, listing secret consumed, order in DELIVERING.
 */
async function deliveredOrder(h: Harness, label: string) {
  const balance = new BalanceService();
  const buyer = await makeUser(h, `${label}-buyer`, LOT_CENTS);
  const seller = await makeUser(h, `${label}-seller`, 0n);

  const product = await h.prisma.product.create({
    data: {
      title: `attack drill ${label} ${randomUUID().slice(0, 8)}`,
      priceCents: LOT_CENTS,
      category: 'STEAM',
      // reserveProductStock decrements first, so selling the last unit leaves 0 in
      // stock with SOLD_OUT. That is the only state auto-delivery can produce.
      quantity: 0,
      status: 'SOLD_OUT',
      sellerId: seller,
      autoDeliver: true,
      deliveryConsumedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      warrantyHours: 10,
    },
  });
  h.productIds.push(product.id);

  const chat = await h.prisma.$transaction((tx) => ensurePairChat(tx, buyer, seller));
  const order = await h.prisma.order.create({
    data: {
      productId: product.id,
      buyerId: buyer,
      sellerId: seller,
      chatId: chat.id,
      totalAmountCents: LOT_CENTS,
      feeCents: FEE_CENTS,
      payoutCents: PAYOUT_CENTS,
      quantity: 1,
      status: 'DELIVERING',
      idempotencyKey: `attack-${randomUUID()}`,
    },
  });
  h.orderIds.push(order.id);

  await h.prisma.message.create({
    data: {
      chatId: chat.id,
      kind: 'SYSTEM',
      senderId: null,
      visibleToUserId: buyer,
      text: 'Автовыдача товара:\n\nsteam://login-token-SUPER-SECRET',
    },
  });
  // The buyer really did pay: the 500 RUB is held, not in their pocket.
  await h.prisma.$transaction((tx) => balance.debit(tx, buyer, LOT_CENTS, 'PURCHASE_HOLD', {
    idempotencyKey: `attack-hold-${order.id}`, description: 'Покупка', source: 'SYSTEM',
  }));

  return { buyer, seller, productId: product.id, orderId: order.id, chatId: chat.id };
}

dbTest('a buyer can no longer refund an auto-delivered order they already received', async () => {
  const h = await harness();
  try {
    const { buyer, seller, orderId, productId } = await deliveredOrder(h, 'self-refund');

    const result = await attempt(
      escrow(h).refundBySeller(actor(buyer), orderId, `attack-${randomUUID()}`, 'Товар не работает'),
    );
    assert.equal(result, 403, 'the seller-only endpoint must refuse a buyer');

    const live = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId }, select: { status: true },
    });
    assert.equal(live.status, 'DELIVERING', 'the order must not move to REFUNDED');

    const buyerAfter = await h.prisma.user.findUniqueOrThrow({
      where: { id: buyer }, select: { balanceCents: true },
    });
    assert.equal(buyerAfter.balanceCents, 0n, 'no money returned to the buyer');

    // The legitimate flow still works, so the fix did not break real refunds.
    await escrow(h).refundBySeller(
      actor(seller), orderId, `seller-${randomUUID()}`, 'Ошибка выдачи',
    );
    const afterSeller = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId }, select: { status: true },
    });
    assert.equal(afterSeller.status, 'REFUNDED', 'the seller can still refund their own order');

    // The consumed secret is not restocked: the ciphertext is already gone, so relisting
    // would sell a lot that can never be fulfilled.
    const product = await h.prisma.product.findUniqueOrThrow({
      where: { id: productId }, select: { status: true, quantity: true },
    });
    assert.equal(product.status, 'SOLD_OUT', 'the lot stays unlisted');
    // Without the fix the stock-restore branch incremented this back to 1 and reopened
    // the listing, letting the same consumed secret be "sold" again.
    assert.equal(product.quantity, 0, 'a consumed auto-delivery secret must not be relisted');

    const flagged = await h.prisma.securityEvent.findMany({
      where: { userId: seller, type: 'FRAUD_ATTEMPT' }, select: { payload: true },
    });
    assert.equal(flagged.length, 1, 'support is told the refund landed after delivery');
    const payload = flagged[0]!.payload as { kind?: string };
    assert.equal(payload.kind, 'REFUND_AFTER_AUTO_DELIVERY');
  } finally {
    await close(h);
  }
});

dbTest('the exploit is not repeatable: every round is refused and flagged', async () => {
  const h = await harness();
  try {
    const outcomes: Array<string | number> = [];
    const buyers: bigint[] = [];
    for (let round = 0; round < 3; round += 1) {
      const { buyer, seller, orderId } = await deliveredOrder(h, `repeat-${round}`);
      buyers.push(buyer);
      outcomes.push(await attempt(
        escrow(h).refundBySeller(actor(buyer), orderId, `attack-${round}-${randomUUID()}`, 'Не работает'),
      ));
      // Keep seller referenced so the fixture stays honest about who owns the order.
      assert.ok(seller);
    }

    assert.deepEqual(outcomes, [403, 403, 403], 'every attempt is refused');
    for (const buyer of buyers) {
      const row = await h.prisma.user.findUniqueOrThrow({
        where: { id: buyer }, select: { balanceCents: true },
      });
      assert.equal(row.balanceCents, 0n, 'no buyer got money back');
    }
  } finally {
    await close(h);
  }
});