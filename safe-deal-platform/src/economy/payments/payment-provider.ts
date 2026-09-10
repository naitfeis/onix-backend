import type { PaymentIntentStatus, PaymentProviderCode, PaymentWallet } from '@prisma/client';

export type CreatePaymentIntentInput = {
  userId: bigint;
  wallet: PaymentWallet;
  amountCents: bigint;
  currency?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type ProviderCreateResult = {
  providerRef?: string;
  status: Extract<PaymentIntentStatus, 'PENDING' | 'SUCCEEDED'>;
  metadata?: Record<string, unknown>;
};

export type ProviderWebhookVerification = {
  ok: boolean;
  /** Provider event id used as idempotency key (required when ok). */
  eventId?: string;
  providerPaymentId?: string;
  intentId?: string;
  status?: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  /** Optional claims — compared to DB intent, never used as credit source. */
  claimedAmountCents?: bigint;
  claimedCurrency?: string;
};

/**
 * PSP adapter contract. Domain code depends only on this interface.
 * New providers (YooKassa, Telegram Wallet, …) implement this — no domain rewrites.
 *
 * HARD GATE: Telegram Wallet (or any money callback) must NOT share
 * `POST /api/telegram/webhook` until payment apply uses transactional
 * claim+ledger idempotency (see payment-webhook-model). Bot webhook durable
 * `update_id` dedupe is necessary but not sufficient for money.
 */
export interface PaymentProvider {
  readonly code: PaymentProviderCode;
  /**
   * Compile-time acknowledgement that createIntent deduplicates by
   * input.idempotencyKey. Required because DB-claim crash recovery can repeat
   * a provider call after the stale ownership window.
   */
  readonly createIntentIsIdempotent: true;
  /**
   * MUST return the same provider intent for the same idempotencyKey, including
   * after process crashes or network timeouts.
   */
  createIntent(input: CreatePaymentIntentInput): Promise<ProviderCreateResult>;
  /**
   * Confirm a pending intent (Manual/admin or PSP webhook mapping).
   * Providers that settle asynchronously may no-op until webhook.
   */
  confirmIntent(intentId: string, providerRef: string | null): Promise<{ status: PaymentIntentStatus }>;
  /**
   * Verify provider signature / authenticity. MUST NOT trust body userId/amount.
   * Real PSPs implement HMAC/JWS check here. Manual returns ok:false (no public webhook).
   */
  verifyWebhook?(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<ProviderWebhookVerification> | ProviderWebhookVerification;
}
