import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CreatePaymentIntentInput, PaymentProvider, ProviderCreateResult } from './payment-provider';

/**
 * Manual / admin payment provider for staging and controlled production top-ups.
 * Real money never moves — credits happen only after explicit confirm under MANUAL_PAYMENTS_ENABLED
 * or admin role (enforced in PaymentsService).
 */
@Injectable()
export class ManualPaymentProvider implements PaymentProvider {
  readonly code = 'MANUAL' as const;

  async createIntent(_input: CreatePaymentIntentInput): Promise<ProviderCreateResult> {
    return {
      status: 'PENDING',
      providerRef: `manual:${Date.now()}`,
      metadata: { channel: 'manual' },
    };
  }

  async confirmIntent(_intentId: string, _providerRef: string | null) {
    return { status: 'SUCCEEDED' as const };
  }
}

/** Stub providers — registered so selection works; create throws until configured. */
@Injectable()
export class UnconfiguredPaymentProvider implements PaymentProvider {
  constructor(readonly code: PaymentProvider['code']) {}

  async createIntent(): Promise<ProviderCreateResult> {
    throw new ForbiddenException(`Платёжный провайдер ${this.code} ещё не подключён.`);
  }

  async confirmIntent() {
    throw new ForbiddenException(`Платёжный провайдер ${this.code} ещё не подключён.`);
    return { status: 'FAILED' as const };
  }
}

export function buildPaymentProviderRegistry(manual: ManualPaymentProvider): PaymentProvider[] {
  return [
    manual,
    new UnconfiguredPaymentProvider('YOOKASSA'),
    new UnconfiguredPaymentProvider('TELEGRAM_WALLET'),
    new UnconfiguredPaymentProvider('CRYPTO'),
    new UnconfiguredPaymentProvider('CARD'),
    new UnconfiguredPaymentProvider('STRIPE'),
  ];
}

export function isManualPaymentsEnabled(): boolean {
  const raw = (process.env.MANUAL_PAYMENTS_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}
