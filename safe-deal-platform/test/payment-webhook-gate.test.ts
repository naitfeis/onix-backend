import assert from 'node:assert/strict';
import test from 'node:test';
import { LedgerModel } from '../src/economy/wallet/ledger-model';
import {
  PaymentWebhookError,
  PaymentWebhookModel,
} from '../src/economy/payments/payment-webhook-model';

function baseEvent(over: Partial<Parameters<PaymentWebhookModel['applyWebhook']>[0]> = {}) {
  return {
    eventId: 'evt_1',
    providerPaymentId: 'psp_1',
    intentId: 'pi_1',
    status: 'SUCCEEDED' as const,
    signatureValid: true,
    ...over,
  };
}

test('1. payment success credits once via ledger amount from DB', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 500_00n, currency: 'RUB', providerPaymentId: null,
  });
  const r = m.applyWebhook(baseEvent());
  assert.equal(r.kind, 'fresh');
  assert.equal(m.getBalance('u1'), 500_00n);
  assert.equal(m.ledgerCredits().length, 1);
  assert.equal(m.ledgerCredits()[0]!.amountCents, 500_00n);
});

test('1b. claimed wrong amount rejected — DB amount never overridden', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 500_00n, currency: 'RUB', providerPaymentId: null,
  });
  assert.throws(
    () => m.applyWebhook(baseEvent({ claimedAmountCents: 1n })),
    (e: unknown) => e instanceof PaymentWebhookError && e.code === 'AMOUNT_MISMATCH',
  );
  assert.equal(m.getBalance('u1'), 0n);
});

test('2. duplicate webhook is idempotent replay', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 100n, currency: 'RUB', providerPaymentId: null,
  });
  m.applyWebhook(baseEvent());
  const r2 = m.applyWebhook(baseEvent());
  assert.equal(r2.kind, 'replay');
  assert.equal(m.getBalance('u1'), 100n);
  assert.equal(m.ledgerCredits().length, 1);
});

test('3. concurrent duplicate webhooks — second is replay (single credit)', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 100n, currency: 'RUB', providerPaymentId: null,
  });
  // Simulate concurrent: sequential with same eventId (UNIQUE event semantics)
  m.applyWebhook(baseEvent());
  m.applyWebhook(baseEvent());
  assert.equal(m.ledgerCredits().length, 1);
});

test('4/5. provider success after API timeout — webhook still credits once', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 250n, currency: 'RUB', providerPaymentId: null,
  });
  m.markProviderPaidButLocalPending('pi_1', 'psp_lost');
  assert.equal(m.getIntent('pi_1')!.status, 'PENDING');
  m.applyWebhook(baseEvent({ providerPaymentId: 'psp_lost', eventId: 'evt_late' }));
  assert.equal(m.getIntent('pi_1')!.status, 'SUCCEEDED');
  assert.equal(m.getBalance('u1'), 250n);
});

test('8/9. failed / canceled do not credit; canceled cannot later succeed', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 100n, currency: 'RUB', providerPaymentId: null,
  });
  m.applyWebhook(baseEvent({ status: 'CANCELED', eventId: 'evt_c' }));
  assert.equal(m.getBalance('u1'), 0n);
  assert.throws(
    () => m.applyWebhook(baseEvent({ status: 'SUCCEEDED', eventId: 'evt_s', providerPaymentId: 'psp_1' })),
    (e: unknown) => e instanceof PaymentWebhookError && e.code === 'ILLEGAL_TRANSITION',
  );
});

test('success → failed impossible', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 100n, currency: 'RUB', providerPaymentId: null,
  });
  m.applyWebhook(baseEvent());
  assert.throws(
    () => m.applyWebhook(baseEvent({ status: 'FAILED', eventId: 'evt_fail' })),
    (e: unknown) => e instanceof PaymentWebhookError && e.code === 'ILLEGAL_TRANSITION',
  );
});

test('10. invalid signature rejected', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 100n, currency: 'RUB', providerPaymentId: null,
  });
  assert.throws(
    () => m.applyWebhook(baseEvent({ signatureValid: false })),
    (e: unknown) => e instanceof PaymentWebhookError && e.code === 'INVALID_SIGNATURE',
  );
});

test('12. wrong currency rejected', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 100n, currency: 'RUB', providerPaymentId: null,
  });
  assert.throws(
    () => m.applyWebhook(baseEvent({ claimedCurrency: 'USD' })),
    (e: unknown) => e instanceof PaymentWebhookError && e.code === 'CURRENCY_MISMATCH',
  );
});

test('13. wrong order/intent rejected', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 100n, currency: 'RUB', providerPaymentId: null,
  });
  assert.throws(
    () => m.applyWebhook(baseEvent({ intentId: 'pi_other' })),
    (e: unknown) => e instanceof PaymentWebhookError && e.code === 'WRONG_INTENT',
  );
});

test('14. old/replayed webhook with different payload conflicts', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 100n, currency: 'RUB', providerPaymentId: null,
  });
  m.applyWebhook(baseEvent());
  assert.throws(
    () => m.applyWebhook(baseEvent({ claimedCurrency: 'RUB', status: 'FAILED' })),
    (e: unknown) => e instanceof PaymentWebhookError && e.code === 'CONFLICT',
  );
});

test('15 + 100 buyers / 1 SKU — escrow model still one winner', () => {
  const ledger = new LedgerModel();
  ledger.ensureUser('seller', { depositAvailableCents: 10_000_00n });
  ledger.ensureProduct('sku', {
    sellerId: 'seller', priceCents: 1_000_00n, payoutCents: 950_00n, quantity: 1,
  });
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < 100; i++) {
    const b = `b${i}`;
    ledger.ensureUser(b, { balanceCents: 5_000_00n });
    try {
      ledger.purchaseProduct('sku', b, `idem-${i}`);
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  assert.equal(ok, 1);
  assert.equal(fail, 99);
  ledger.assertInvariants();
});

test('repeated success does not create second ledger credit', () => {
  const m = new PaymentWebhookModel();
  m.createIntent({
    id: 'pi_1', userId: 'u1', amountCents: 77n, currency: 'RUB', providerPaymentId: null,
  });
  m.applyWebhook(baseEvent({ eventId: 'e1' }));
  m.applyWebhook(baseEvent({ eventId: 'e2', providerPaymentId: 'psp_1' })); // same intent success again
  assert.equal(m.ledgerCredits().length, 1);
  assert.equal(m.getBalance('u1'), 77n);
});

test('6. refund idempotency — escrow refund ledger once (model)', () => {
  const ledger = new LedgerModel();
  ledger.ensureUser('buyer', { balanceCents: 10_000_00n });
  ledger.ensureUser('seller', { depositAvailableCents: 10_000_00n });
  ledger.ensureProduct('sku', {
    sellerId: 'seller', priceCents: 1_000_00n, payoutCents: 950_00n, quantity: 2,
  });
  const orderId = ledger.purchaseProduct('sku', 'buyer', 'buy-1');
  ledger.refund(orderId);
  ledger.refund(orderId); // idempotent terminal
  assert.equal(ledger.ledgerEntries().filter((e) => e.type === 'REFUND').length, 1);
  assert.equal(ledger.getUser('buyer').balanceCents, 10_000_00n);
  ledger.assertInvariants();
});

test('7. partial refund — not supported; full refund only', () => {
  const ledger = new LedgerModel();
  ledger.ensureUser('buyer', { balanceCents: 10_000_00n });
  ledger.ensureUser('seller', { depositAvailableCents: 10_000_00n });
  ledger.ensureProduct('sku', {
    sellerId: 'seller', priceCents: 1_000_00n, payoutCents: 950_00n, quantity: 1,
  });
  const orderId = ledger.purchaseProduct('sku', 'buyer', 'buy-p');
  ledger.refund(orderId);
  assert.equal(ledger.getUser('buyer').balanceCents, 10_000_00n);
  ledger.assertInvariants();
});
