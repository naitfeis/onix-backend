import type { Prisma } from '@prisma/client';
import { structuredLog } from '../observability/structured-logger';

type Db = Prisma.TransactionClient;

/**
 * "A fraudster must not be able to cheat the same person twice."
 *
 * Shared by every purchase path — wallet purchase and card checkout alike — because a
 * single implementation is the only way both stay in step. Card checkout settles the
 * order AFTER the provider captures funds, so the check must run when the checkout
 * intent is created, not at settlement: refusing there would strand the buyer's money.
 *
 * Two conditions count as a proven prior failure by this seller toward this buyer:
 *  - a REFUNDED order: the platform already established non-delivery or bad goods;
 *  - unrecovered clawback debt on the pair: the seller still owes this buyer.
 */
export async function findPriorFailedDelivery(
  tx: Db,
  buyerId: bigint,
  sellerId: bigint,
): Promise<string | null> {
  try {
    const refunded = await tx.order.findFirst({
      where: { buyerId, sellerId, status: 'REFUNDED' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (refunded) {
      return `seller already failed a deal with this buyer (order ${refunded.id.toString()})`;
    }

    const owed = await tx.order.findFirst({
      where: {
        buyerId,
        sellerId,
        clawback: { status: { in: ['OPEN', 'PARTIAL'] } },
      },
      select: { id: true },
    });
    if (owed) {
      return `seller still owes a refund from order ${owed.id.toString()}`;
    }
  } catch (error) {
    // Matches the ban-evasion convention: a throwing lookup must not silently read as
    // "clean pair", but it also must not turn a transient DB fault into a full purchase
    // outage. Fail open, loudly.
    structuredLog.error('repeat-victim lookup failed — treated as clean pair', {
      buyerId: buyerId.toString(),
      sellerId: sellerId.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}

/** Buyer-facing message: names the reason without exposing counterparty details. */
export const REPEAT_VICTIM_MESSAGE =
  'С этим продавцом у вас уже был спорный заказ с возвратом. Новая сделка недоступна — напишите в поддержку, если считаете это ошибкой.';