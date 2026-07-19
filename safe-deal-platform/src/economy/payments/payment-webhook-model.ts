/**
 * Pure in-memory payment webhook state machine for launch-gate tests.
 * Mirrors intended production rules — no DB, no balance += amount.
 */

export class PaymentWebhookError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_SIGNATURE'
      | 'IDEMPOTENCY_REPLAY'
      | 'AMOUNT_MISMATCH'
      | 'CURRENCY_MISMATCH'
      | 'WRONG_INTENT'
      | 'ILLEGAL_TRANSITION'
      | 'ALREADY_CREDITED'
      | 'CONFLICT',
  ) {
    super(message);
    this.name = 'PaymentWebhookError';
  }
}

export type IntentStatus = 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'EXPIRED';

export type PaymentIntentRow = {
  id: string;
  userId: string;
  amountCents: bigint;
  currency: string;
  status: IntentStatus;
  providerPaymentId: string | null;
  credited: boolean;
};

export type LedgerCredit = {
  idempotencyKey: string;
  intentId: string;
  userId: string;
  amountCents: bigint;
};

export type WebhookEvent = {
  eventId: string;
  providerPaymentId: string;
  intentId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  /** Attacker-controlled — must not drive credit amount. */
  claimedAmountCents?: bigint;
  claimedCurrency?: string;
  claimedUserId?: string;
  signatureValid: boolean;
};

/**
 * Minimal PSP webhook processor used by Payment Launch Gate tests.
 *
 * Flow: verify signature → idempotency → atomic apply → ledger credit (once).
 */
export class PaymentWebhookModel {
  private readonly intents = new Map<string, PaymentIntentRow>();
  private readonly events = new Map<string, { payloadHash: string; resultIntentId: string }>();
  private readonly providerPaymentIds = new Set<string>();
  private readonly ledger: LedgerCredit[] = [];
  private readonly balances = new Map<string, bigint>();

  createIntent(row: Omit<PaymentIntentRow, 'credited' | 'status'> & { status?: IntentStatus }): PaymentIntentRow {
    if (this.intents.has(row.id)) throw new PaymentWebhookError('intent exists', 'CONFLICT');
    if (row.providerPaymentId) {
      if (this.providerPaymentIds.has(row.providerPaymentId)) {
        throw new PaymentWebhookError('providerPaymentId not unique', 'CONFLICT');
      }
      this.providerPaymentIds.add(row.providerPaymentId);
    }
    const intent: PaymentIntentRow = {
      ...row,
      status: row.status ?? 'PENDING',
      credited: false,
    };
    this.intents.set(intent.id, intent);
    if (!this.balances.has(intent.userId)) this.balances.set(intent.userId, 0n);
    return intent;
  }

  getIntent(id: string): PaymentIntentRow | undefined {
    return this.intents.get(id);
  }

  getBalance(userId: string): bigint {
    return this.balances.get(userId) ?? 0n;
  }

  ledgerCredits(): LedgerCredit[] {
    return [...this.ledger];
  }

  private hashPayload(event: WebhookEvent): string {
    return JSON.stringify({
      providerPaymentId: event.providerPaymentId,
      intentId: event.intentId,
      status: event.status,
      claimedAmountCents: event.claimedAmountCents?.toString() ?? null,
      claimedCurrency: event.claimedCurrency ?? null,
    });
  }

  /** Apply provider webhook once per eventId. */
  applyWebhook(event: WebhookEvent): { kind: 'fresh' | 'replay'; intent: PaymentIntentRow } {
    if (!event.signatureValid) {
      throw new PaymentWebhookError('invalid provider signature', 'INVALID_SIGNATURE');
    }

    const payloadHash = this.hashPayload(event);
    const prior = this.events.get(event.eventId);
    if (prior) {
      if (prior.payloadHash !== payloadHash) {
        throw new PaymentWebhookError('idempotency conflict', 'CONFLICT');
      }
      const intent = this.intents.get(prior.resultIntentId)!;
      return { kind: 'replay', intent };
    }

    const intent = this.intents.get(event.intentId);
    if (!intent) throw new PaymentWebhookError('unknown intent', 'WRONG_INTENT');

    // Bind provider payment id (unique).
    if (intent.providerPaymentId && intent.providerPaymentId !== event.providerPaymentId) {
      throw new PaymentWebhookError('providerPaymentId mismatch', 'WRONG_INTENT');
    }
    if (!intent.providerPaymentId) {
      if (this.providerPaymentIds.has(event.providerPaymentId)) {
        throw new PaymentWebhookError('providerPaymentId already used', 'CONFLICT');
      }
      intent.providerPaymentId = event.providerPaymentId;
      this.providerPaymentIds.add(event.providerPaymentId);
    }

    // Never trust claimed user/amount/currency for money movement.
    if (event.claimedUserId && event.claimedUserId !== intent.userId) {
      throw new PaymentWebhookError('claimed userId ignored/rejected', 'WRONG_INTENT');
    }
    if (event.claimedAmountCents !== undefined && event.claimedAmountCents !== intent.amountCents) {
      throw new PaymentWebhookError('amount mismatch vs DB intent', 'AMOUNT_MISMATCH');
    }
    if (event.claimedCurrency && event.claimedCurrency !== intent.currency) {
      throw new PaymentWebhookError('currency mismatch vs DB intent', 'CURRENCY_MISMATCH');
    }

    if (event.status === 'SUCCEEDED') {
      this.applySuccess(intent);
    } else {
      this.applyTerminalFailure(intent, event.status);
    }

    this.events.set(event.eventId, { payloadHash, resultIntentId: intent.id });
    return { kind: 'fresh', intent };
  }

  private applySuccess(intent: PaymentIntentRow): void {
    if (intent.status === 'SUCCEEDED') {
      // Idempotent success (provider success but API timeout / duplicate).
      return;
    }
    if (intent.status === 'CANCELED' || intent.status === 'FAILED' || intent.status === 'EXPIRED') {
      throw new PaymentWebhookError(`cannot succeed from ${intent.status}`, 'ILLEGAL_TRANSITION');
    }
    if (intent.credited) {
      throw new PaymentWebhookError('already credited', 'ALREADY_CREDITED');
    }

    // Credit ONLY from DB intent amount via ledger key unique per intent.
    const key = `payment:${intent.id}:main`;
    if (this.ledger.some((l) => l.idempotencyKey === key)) {
      throw new PaymentWebhookError('duplicate credit', 'ALREADY_CREDITED');
    }
    const bal = (this.balances.get(intent.userId) ?? 0n) + intent.amountCents;
    this.balances.set(intent.userId, bal);
    this.ledger.push({
      idempotencyKey: key,
      intentId: intent.id,
      userId: intent.userId,
      amountCents: intent.amountCents,
    });
    intent.credited = true;
    intent.status = 'SUCCEEDED';
  }

  private applyTerminalFailure(intent: PaymentIntentRow, status: 'FAILED' | 'CANCELED'): void {
    if (intent.status === 'SUCCEEDED') {
      throw new PaymentWebhookError('success → failed impossible', 'ILLEGAL_TRANSITION');
    }
    if (intent.status === 'CANCELED' || intent.status === 'FAILED' || intent.status === 'EXPIRED') {
      // Idempotent terminal
      return;
    }
    intent.status = status;
  }

  /** Simulate provider success recorded locally as pending (lost API response). */
  markProviderPaidButLocalPending(intentId: string, providerPaymentId: string): void {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error('missing');
    intent.providerPaymentId = providerPaymentId;
    this.providerPaymentIds.add(providerPaymentId);
    // status stays PENDING until webhook
  }
}
