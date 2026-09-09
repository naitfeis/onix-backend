import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

const OPEN_ORDER_STATUSES = new Set(['PAYMENT_HOLD', 'DELIVERING', 'DISPUTE']);

/**
 * Support tickets linked to an order cannot close until the order reaches a terminal state.
 */
export async function assertOrderResolvedForTicketClose(
  tx: Prisma.TransactionClient,
  orderId: bigint | null | undefined,
): Promise<void> {
  if (orderId == null) return;
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  if (!order) return;
  if (OPEN_ORDER_STATUSES.has(order.status)) {
    throw new BadRequestException(
      'Нельзя закрыть обращение, пока по сделке не принято решение (завершение, возврат или отмена).',
    );
  }
}
