import { ConflictException } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';

/** Terminal order statuses — no further non-idempotent transitions. */
export const ORDER_TERMINAL = new Set<OrderStatus>(['COMPLETED', 'CANCELED', 'REFUNDED']);

/** Non-terminal statuses where a support ticket must stay open until resolution. */
export const OPEN_ORDER_STATUSES = new Set<OrderStatus>(['PAYMENT_HOLD', 'DELIVERING', 'DISPUTE']);

export const OPEN_SUPPORT_TICKET_STATUSES = ['OPEN', 'IN_REVIEW', 'WAITING_USER'] as const;

/**
 * Canonical escrow state machine (enforced in EscrowService — FE hide is not a control).
 *
 * PENDING → PAYMENT_HOLD          purchase (system)
 * PAYMENT_HOLD → DELIVERING       seller deliver | auto-deliver
 * PAYMENT_HOLD → CANCELED         buyer cancel (or support via cancel)
 * PAYMENT_HOLD → DISPUTE          party support/dispute
 * PAYMENT_HOLD → REFUNDED         seller refund-request | admin refund
 * DELIVERING → COMPLETED          buyer complete
 * DELIVERING → DISPUTE            party support/dispute
 * DELIVERING → REFUNDED           seller refund-request | admin refund
 * DISPUTE → COMPLETED             admin/support complete only
 * DISPUTE → REFUNDED              seller refund-request | admin refund
 * COMPLETED → REFUNDED            seller refund-request | admin refund (clawback)
 * PAYMENT_HOLD → COMPLETED        admin/support only (seller forgot deliver)
 *
 * Forbidden (must stay impossible via API for non-admin actors):
 *   PAYMENT_HOLD → COMPLETED (buyer)
 *   DELIVERING → CANCELED
 *   COMPLETED → CANCELED
 *   REFUNDED → * (except idempotent replay)
 *   CANCELED → *
 *   COMPLETED → DELIVERING / DISPUTE / PAYMENT_HOLD
 */
export const BUYER_COMPLETE_FROM: OrderStatus[] = ['DELIVERING'];
/** Admin/support: full spectrum on open escrow — including PAYMENT_HOLD if seller never clicked deliver. */
export const ADMIN_COMPLETE_FROM: OrderStatus[] = ['PAYMENT_HOLD', 'DELIVERING', 'DISPUTE'];
export const SELLER_DELIVER_FROM: OrderStatus = 'PAYMENT_HOLD';
export const BUYER_CANCEL_FROM: OrderStatus[] = ['PAYMENT_HOLD'];
export const REFUND_FROM: OrderStatus[] = ['PAYMENT_HOLD', 'DELIVERING', 'DISPUTE', 'COMPLETED'];
export const DISPUTE_FROM: OrderStatus[] = ['PAYMENT_HOLD', 'DELIVERING'];

/** Money conservation: fee + seller proceeds must equal buyer total. */
export function assertOrderMoneySplit(order: {
  totalAmountCents: bigint;
  feeCents: bigint;
  payoutCents: bigint;
}): void {
  if (order.payoutCents < 0n || order.feeCents < 0n || order.totalAmountCents < 0n) {
    throw new ConflictException('Некорректные суммы сделки.');
  }
  if (order.payoutCents > order.totalAmountCents) {
    throw new ConflictException('Выплата продавцу превышает сумму заказа.');
  }
  if (order.feeCents + order.payoutCents !== order.totalAmountCents) {
    throw new ConflictException('Комиссия и выплата не сходятся с суммой заказа.');
  }
}

export function assertNotTerminalForMutation(status: OrderStatus, action: string): void {
  if (ORDER_TERMINAL.has(status)) {
    throw new ConflictException(`Сделка уже в статусе ${status}: действие «${action}» недоступно.`);
  }
}

export function assertStatusIn(
  status: OrderStatus,
  allowed: readonly OrderStatus[],
  action: string,
): void {
  if (!allowed.includes(status)) {
    throw new ConflictException(
      `Недопустимый переход для «${action}» из статуса ${status}.`,
    );
  }
}
