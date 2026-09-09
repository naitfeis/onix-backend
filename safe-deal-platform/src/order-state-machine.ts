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
 *
 * Forbidden (must stay impossible via API):
 *   PAYMENT_HOLD → COMPLETED (buyer or admin)
 *   DELIVERING → CANCELED
 *   COMPLETED → CANCELED
 *   REFUNDED → * (except idempotent replay)
 *   CANCELED → *
 *   COMPLETED → DELIVERING / DISPUTE / PAYMENT_HOLD
 */
export const BUYER_COMPLETE_FROM: OrderStatus[] = ['DELIVERING'];
/** Admin may resolve DISPUTE or finish after deliver — never skip delivery from PAYMENT_HOLD. */
export const ADMIN_COMPLETE_FROM: OrderStatus[] = ['DELIVERING', 'DISPUTE'];
export const SELLER_DELIVER_FROM: OrderStatus = 'PAYMENT_HOLD';
export const BUYER_CANCEL_FROM: OrderStatus[] = ['PAYMENT_HOLD'];
export const REFUND_FROM: OrderStatus[] = ['PAYMENT_HOLD', 'DELIVERING', 'DISPUTE', 'COMPLETED'];
export const DISPUTE_FROM: OrderStatus[] = ['PAYMENT_HOLD', 'DELIVERING'];

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
