import { structuredLog } from './structured-logger';

export type MoneyEventName =
  | 'deposit'
  | 'escrow_lock'
  | 'escrow_release'
  | 'refund'
  | 'withdrawal'
  | 'payment_webhook'
  | 'payment_confirm'
  | 'purchase_hold'
  | 'seller_payout'
  | 'admin_adjust';

/**
 * Structured money-op log — never include secrets / full payloads.
 * amount is cents (number or stringified bigint).
 */
export function logMoneyEvent(
  event: MoneyEventName,
  fields: {
    status: 'success' | 'replay' | 'error';
    operationId?: string;
    dealId?: string;
    paymentId?: string;
    userId?: string;
    amount?: string | number;
    requestId?: string;
    [key: string]: string | number | boolean | undefined;
  },
): void {
  structuredLog.info(event, {
    event,
    ...fields,
  });
}
