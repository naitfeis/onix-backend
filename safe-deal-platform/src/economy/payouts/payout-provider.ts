import type { PayoutProviderCode } from '@prisma/client';

export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');

export type PayoutSubmission = {
  payoutRequestId: string;
  attemptKey: string;
  amountCents: bigint;
  currency: string;
  destinationFingerprint: string | null;
};

export type PayoutSubmissionResult =
  | { outcome: 'SUBMITTED'; providerReference: string }
  | { outcome: 'MANUAL_REVIEW'; reason: string }
  | { outcome: 'FAILED'; code: string; message: string };

export interface PayoutProvider {
  readonly code: PayoutProviderCode;
  /** True only for a configured provider that can actually initiate a transfer. */
  readonly externalTransferCapable: boolean;
  submit(input: PayoutSubmission): Promise<PayoutSubmissionResult>;
}
