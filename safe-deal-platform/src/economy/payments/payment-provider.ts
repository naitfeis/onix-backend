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

/**
 * PSP adapter contract. Domain code depends only on this interface.
 * New providers (YooKassa, Telegram Wallet, …) implement this — no domain rewrites.
 */
export interface PaymentProvider {
  readonly code: PaymentProviderCode;
  createIntent(input: CreatePaymentIntentInput): Promise<ProviderCreateResult>;
  /**
   * Confirm a pending intent (Manual/admin or PSP webhook mapping).
   * Providers that settle asynchronously may no-op until webhook.
   */
  confirmIntent(intentId: string, providerRef: string | null): Promise<{ status: PaymentIntentStatus }>;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
