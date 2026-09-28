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

test('warranty hold scan is bounded to the max warranty window', () => {
  // Scale guard for 10k deals/month: the scan runs inside every purchase and
  // withdraw Serializable TX. Without the completedAt floor it re-reads the
  // seller's entire completed order history forever.
  const source = repoFile('safe-deal-platform/src/economy/wallet/sale-proceeds-hold.ts');
  assert.match(source, /completedAt:\s*\{\s*gte:\s*scanFloor\s*\}/);
  assert.match(source, /WARRANTY_MAX_HOURS \* 3_600_000/);
  // The bound must not reintroduce the unbounded `not: null` form.
  assert.doesNotMatch(source, /completedAt:\s*\{\s*not:\s*null\s*\}/);
  // Correctness of the bound depends on the per-order clamp to the same ceiling.
  assert.match(source, /Math\.min\(Math\.round\(hours\), WARRANTY_MAX_HOURS\)/);
});

test('self-service refund after COMPLETED is limited to the warranty window', () => {
  // Money-creation guard: outside the window the seller's payout is already
  // withdrawable, so the clawback records uncollectable debt while the buyer is
  // refunded in full — the platform funds the difference (fee + drained payout).
  const escrow = repoFile('safe-deal-platform/src/escrow.module.ts');
  assert.match(escrow, /warrantyWindowOpenForOrder\(tx, order\)/);
  assert.match(escrow, /Гарантийное окно по сделке закрыто/);
  // Support keeps the human override.
  assert.match(escrow, /if \(!support && !\(await warrantyWindowOpenForOrder/);
});

test('withdraw endpoint is rate limited via the distributed limiter', () => {
  const ops = repoFile('safe-deal-platform/src/operations.module.ts');
  assert.match(ops, /rateLimit\.assert\(`wallet:withdraw:\$\{user\.id\}`/);
  // An in-process limiter would multiply the budget by the instance count.
  assert.doesNotMatch(ops, /assertRateLimit\(`wallet:withdraw:/);
});

test('every money-mutating endpoint uses the distributed limiter', () => {
  // Scale guard for 10k deals/month: these routes move real funds, so their
  // throttle budget must be shared across API instances rather than per-process.
  const escrow = repoFile('safe-deal-platform/src/escrow.module.ts');
  const economy = repoFile('safe-deal-platform/src/economy/economy.controller.ts');
  const ops = repoFile('safe-deal-platform/src/operations.module.ts');
  const tick = String.fromCharCode(96);
  const distributed = (source: string, key: string) => {
    assert.ok(
      source.includes(`rateLimit.assert(${tick}${key}:`),
      `${key} must use the distributed limiter`,
    );
    assert.ok(
      !source.includes(`assertRateLimit(${tick}${key}:`),
      `${key} must not use the in-process limiter`,
    );
  };
  for (const key of ['order:purchase', 'order:mutate', 'order:refund']) distributed(escrow, key);
  for (const key of ['payment:create', 'wallet:deposit']) distributed(economy, key);
  distributed(ops, 'wallet:withdraw');
  // The controllers must actually receive the shared limiter through DI.
  assert.match(escrow, /private readonly rateLimit: DistributedRateLimiter/);
  assert.match(economy, /private readonly rateLimit: DistributedRateLimiter/);
  assert.match(ops, /private readonly rateLimit: DistributedRateLimiter/);
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
