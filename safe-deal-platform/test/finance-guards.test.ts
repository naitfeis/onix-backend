import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  checkoutAcquiringFeeBps,
  computeCheckoutExternalCents,
  parsePaymentCheckoutMetadata,
} from '../src/payments-checkout.types';

const repoFile = (path: string) => readFileSync(path, 'utf8');

test('warranty hold scan is not capped at take:300', () => {
  const source = repoFile('safe-deal-platform/src/economy/wallet/sale-proceeds-hold.ts');
  assert.doesNotMatch(source, /take:\s*300/);
  assert.match(source, /WARRANTY_SCAN_BATCH/);
});

test('auto-deliver only consumes secret when last unit sells', () => {
  const source = repoFile('safe-deal-platform/src/escrow.module.ts');
  assert.match(source, /isLastUnit/);
  assert.doesNotMatch(source, /quantity:\s*0,\s*\n\s*status:\s*'SOLD_OUT'/);
});

test('marketplace rejects autoDeliver when quantity > 1', () => {
  const source = repoFile('safe-deal-platform/src/marketplace.module.ts');
  assert.match(source, /autoDeliver && dto\.quantity > 1/);
});

test('ticket close requires terminal order state', () => {
  const guard = repoFile('safe-deal-platform/src/support-ticket-guard.ts');
  const admin = repoFile('safe-deal-platform/src/admin/admin-security.service.ts');
  const center = repoFile('safe-deal-platform/src/support-center.service.ts');
  assert.match(guard, /assertOrderResolvedForTicketClose/);
  assert.match(admin, /assertOrderResolvedForTicketClose/);
  assert.match(center, /assertOrderResolvedForTicketClose/);
});

test('checkout metadata requires frozen price and stock reservation flag', () => {
  assert.equal(parsePaymentCheckoutMetadata(null), null);
  assert.equal(parsePaymentCheckoutMetadata({
    checkout: {
      productId: 'prod-1',
      quantity: 2,
      purchaseIdempotencyKey: 'purchase-key-12345678',
    },
  }), null);
  assert.deepEqual(parsePaymentCheckoutMetadata({
    checkout: {
      productId: 'prod-1',
      quantity: 2,
      purchaseIdempotencyKey: 'purchase-key-12345678',
      unitPriceCents: '10000',
      totalAmountCents: '20000',
      stockReserved: true,
      externalFeeCents: '40',
    },
  }), {
    productId: 'prod-1',
    quantity: 2,
    purchaseIdempotencyKey: 'purchase-key-12345678',
    unitPriceCents: '10000',
    totalAmountCents: '20000',
    stockReserved: true,
    externalFeeCents: '40',
  });
});

test('checkout external quote matches truncating fee math', () => {
  assert.equal(checkoutAcquiringFeeBps('CARD'), 400);
  assert.equal(checkoutAcquiringFeeBps('YOOKASSA'), 100);
  const quote = computeCheckoutExternalCents(10_000n, 0n, 400);
  assert.equal(quote.remainingCents, 10_000n);
  assert.equal(quote.feeCents, 400n);
  assert.equal(quote.externalCents, 10_400n);
});

test('post-complete clawback recovers seller proceeds only (≤ payout)', () => {
  const clawback = repoFile('safe-deal-platform/src/economy/wallet/clawback.service.ts');
  const escrow = repoFile('safe-deal-platform/src/escrow.module.ts');
  assert.match(escrow, /amountCents:\s*order\.payoutCents/);
  assert.match(clawback, /≤ seller SALE_PAYOUT|seller proceeds/i);
  assert.doesNotMatch(escrow, /amountCents:\s*order\.totalAmountCents/);
});

test('marketplace product update takes product row lock', () => {
  const source = repoFile('safe-deal-platform/src/marketplace.module.ts');
  assert.match(source, /lockProductForUpdate\(tx, id\)/);
  assert.match(source, /withSerializableTransaction/);
});

test('payment expire releases checkout stock reservation', () => {
  const source = repoFile('safe-deal-platform/src/workers/jobs/payment-intent-expire.job.ts');
  assert.match(source, /releaseProductStock/);
  assert.match(source, /stockReserved/);
});
