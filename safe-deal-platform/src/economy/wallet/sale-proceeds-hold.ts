import type { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

/**
 * SALE_PAYOUT funds remain held for withdraw while the order warranty window is open.
 * Prevents COMPLETED → withdraw → refund float (buyer refunded, seller already cashed out).
 */
export async function warrantyHeldSaleProceedsCents(
  tx: Db,
  sellerId: bigint,
  now = new Date(),
): Promise<bigint> {
  const orders = await tx.order.findMany({
    where: {
      sellerId,
      status: 'COMPLETED',
      completedAt: { not: null },
      payoutCents: { gt: 0 },
    },
    select: {
      payoutCents: true,
      completedAt: true,
      product: { select: { warrantyHours: true } },
    },
    orderBy: { completedAt: 'desc' },
    take: 300,
  });

  let held = 0n;
  const nowMs = now.getTime();
  for (const order of orders) {
    if (!order.completedAt) continue;
    const hours = order.product.warrantyHours ?? 10;
    const endsAt = order.completedAt.getTime() + hours * 3_600_000;
    if (endsAt > nowMs) held += order.payoutCents;
  }
  return held;
}
