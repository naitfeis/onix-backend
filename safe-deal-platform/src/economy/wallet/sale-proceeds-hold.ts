import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { BalanceService } from './balance.service';

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
  let cursor: bigint | undefined;

  for (;;) {
    const orders = await tx.order.findMany({
      where: {
        sellerId,
        status: 'COMPLETED',
        completedAt: { not: null },
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
      const hours = order.product.warrantyHours ?? 10;
      const endsAt = order.completedAt.getTime() + hours * 3_600_000;
      if (endsAt > nowMs) held += order.payoutCents;
    }

    if (orders.length < WARRANTY_SCAN_BATCH) break;
    cursor = orders[orders.length - 1].id;
  }

  return held;
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
