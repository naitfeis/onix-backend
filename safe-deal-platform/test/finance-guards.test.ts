import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parsePaymentCheckoutMetadata } from '../src/payments-checkout.types';

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

test('parsePaymentCheckoutMetadata validates checkout binding', () => {
  assert.equal(parsePaymentCheckoutMetadata(null), null);
  assert.deepEqual(parsePaymentCheckoutMetadata({
    checkout: {
      productId: 'prod-1',
      quantity: 2,
      purchaseIdempotencyKey: 'purchase-key-12345678',
    },
  }), {
    productId: 'prod-1',
    quantity: 2,
    purchaseIdempotencyKey: 'purchase-key-12345678',
  });
});
