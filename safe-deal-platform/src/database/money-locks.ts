import { Prisma } from '@prisma/client';

/**
 * Stable lock order for money transactions:
 *   1. Order (if any)
 *   2. Product (if any)
 *   3. Users by ascending id
 *
 * Taking User/Product locks in this order avoids the purchase↔complete deadlock
 * (purchase used to lock the listing then the seller; complete credited the
 * seller then touched the listing).
 */
export async function lockOrderForUpdate(
  tx: Prisma.TransactionClient,
  orderId: bigint,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
}

export async function lockProductForUpdate(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE`;
}

export async function lockPaymentIntentForUpdate(
  tx: Prisma.TransactionClient,
  intentId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "PaymentIntent" WHERE "id" = ${intentId} FOR UPDATE`;
}

export async function lockUsersInIdOrder(
  tx: Prisma.TransactionClient,
  userIds: readonly bigint[],
): Promise<void> {
  const ids = [...new Set(userIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (ids.length === 0) return;
  if (ids.length === 1) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ids[0]} FOR UPDATE`;
    return;
  }
  if (ids.length === 2) {
    await tx.$queryRaw`
      SELECT "id"
      FROM "User"
      WHERE "id" IN (${ids[0]}, ${ids[1]})
      ORDER BY "id"
      FOR UPDATE
    `;
    return;
  }
  await tx.$queryRaw`
    SELECT "id"
    FROM "User"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `;
}
