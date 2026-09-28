import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { BalanceService } from './balance.service';
import { WARRANTY_DEFAULT_HOURS, WARRANTY_MAX_HOURS } from '../../marketplace/warranty';

type Db = Prisma.TransactionClient;

const WARRANTY_SCAN_BATCH = 500;

/**
 * SALE_PAYOUT funds remain held for withdraw/spend while the order warranty window is open.
 * Prevents COMPLETED → spend/withdraw → refund float (buyer refunded, seller already cashed out).
 */
export async function warrantyHeldSaleProceedsCents(
  tx: Db,
  sellerId: bigint,
  now = new Date(),
): Promise<bigint> {
  let held = 0n;
  const nowMs = now.getTime();
  // A warranty window can never extend past WARRANTY_MAX_HOURS after completion
  // (warrantyWindowMsFor re-clamps legacy rows), so anything completed earlier is
  // already released. Bounding the scan keeps this O(recent orders) instead of
  // O(all-time orders) — it runs inside every purchase/withdraw Serializable TX,
  // where a growing scan both slows the money path and raises conflict rates.
  const scanFloor = new Date(nowMs - WARRANTY_MAX_HOURS * 3_600_000);
  let cursor: bigint | undefined;

  for (;;) {
    const orders = await tx.order.findMany({
      where: {
        sellerId,
        status: 'COMPLETED',
        completedAt: { gte: scanFloor },
        payoutCents: { gt: 0 },
        ...(cursor !== undefined ? { id: { lt: cursor } } : {}),
      },
      select: {
        id: true,
        payoutCents: true,
        completedAt: true,
        product: { select: { warrantyHours: true } },
      },
      orderBy: { id: 'desc' },
      take: WARRANTY_SCAN_BATCH,
    });
    if (!orders.length) break;

    for (const order of orders) {
      if (!order.completedAt) continue;
      const endsAt = order.completedAt.getTime()
        + warrantyWindowMsFor(order.product.warrantyHours);
      if (endsAt > nowMs) held += order.payoutCents;
    }

    if (orders.length < WARRANTY_SCAN_BATCH) break;
    cursor = orders[orders.length - 1].id;
  }

  return held;
}

/**
 * Effective warranty window for one completed order, in ms.
 *
 * `warrantyHours` is clamped to WARRANTY_MAX_HOURS at listing time, but legacy
 * rows may predate that clamp — so the ceiling is re-applied here. A null
 * product value falls back to the platform default, matching the hold math above.
 */
function warrantyWindowMsFor(warrantyHours: number | null | undefined): number {
  const hours = warrantyHours ?? WARRANTY_DEFAULT_HOURS;
  const safe = Number.isFinite(hours) && hours > 0
    ? Math.min(Math.round(hours), WARRANTY_MAX_HOURS)
    : WARRANTY_DEFAULT_HOURS;
  return safe * 3_600_000;
}

/**
 * True while a COMPLETED order is still inside its warranty window.
 *
 * This is the same window `warrantyHeldSaleProceedsCents` holds the seller's
 * proceeds for. Once it closes the proceeds become freely spendable and
 * withdrawable, so a post-COMPLETED refund can no longer be funded from the
 * seller's balance — the platform would absorb the loss. The refund path uses
 * this to reject self-service refunds outside the window.
 */
export async function warrantyWindowOpenForOrder(
  tx: Db,
  order: { id: bigint; completedAt: Date | null; productId: string },
  now = new Date(),
): Promise<boolean> {
  if (!order.completedAt) return false;
  const product = await tx.product.findUnique({
    where: { id: order.productId },
    select: { warrantyHours: true },
  });
  const endsAt = order.completedAt.getTime() + warrantyWindowMsFor(product?.warrantyHours ?? null);
  return endsAt > now.getTime();
}

/** Unrecovered post-COMPLETED refund debt — must not be spent or moved to deposit. */
export async function openClawbackDebtCents(tx: Db, userId: bigint): Promise<bigint> {
  const rows = await tx.orderClawback.findMany({
    where: { sellerId: userId, status: { in: ['OPEN', 'PARTIAL'] } },
    select: { amountCents: true, recoveredCents: true },
  });
  let debt = 0n;
  for (const row of rows) {
    const left = row.amountCents - row.recoveredCents;
    if (left > 0n) debt += left;
  }
  return debt;
}

export async function nonSpendableBalanceCents(tx: Db, userId: bigint, now = new Date()): Promise<bigint> {
  const [warrantyHeld, clawbackDebt] = await Promise.all([
    warrantyHeldSaleProceedsCents(tx, userId, now),
    openClawbackDebtCents(tx, userId),
  ]);
  return warrantyHeld + clawbackDebt;
}

export async function spendableBalanceCents(
  tx: Db,
  balance: BalanceService,
  userId: bigint,
  now = new Date(),
): Promise<bigint> {
  const available = await balance.getAvailable(tx, userId);
  const blocked = await nonSpendableBalanceCents(tx, userId, now);
  return available > blocked ? available - blocked : 0n;
}

export async function assertSpendableBalance(
  tx: Db,
  balance: BalanceService,
  userId: bigint,
  amountCents: bigint,
  label = 'Недостаточно доступных средств.',
): Promise<void> {
  if (amountCents <= 0n) return;
  const spendable = await spendableBalanceCents(tx, balance, userId);
  if (amountCents > spendable) {
    throw new BadRequestException(label);
  }
}
