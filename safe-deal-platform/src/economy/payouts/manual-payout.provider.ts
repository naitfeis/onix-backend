import { Injectable } from '@nestjs/common';
import type {
  PayoutProvider, PayoutSubmission, PayoutSubmissionResult,
} from './payout-provider';

@Injectable()
export class ManualPayoutProvider implements PayoutProvider {
  readonly code = 'MANUAL' as const;
  readonly externalTransferCapable = false;

  async submit(_input: PayoutSubmission): Promise<PayoutSubmissionResult> {
    return {
      outcome: 'MANUAL_REVIEW',
      reason: 'MANUAL provider cannot initiate or confirm an external transfer.',
    };
  }
}
