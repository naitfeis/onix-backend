import assert from 'node:assert/strict';
import test from 'node:test';
import { LedgerModel } from '../src/economy/wallet/ledger-model';

/**
 * Integration-style e2e over the pure monetary model (no DB).
 * Covers every money invariant the platform must uphold.
 */

test('e2e: purchase hold debits buyer exactly once (idempotent key)', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 10_000_00n });
  m.ensureUser('seller', { balanceCents: 0n });
  m.purchase('o1', 'buyer', 'seller', 3_000_00n, 2_850_00n, 'idem-1');
  m.purchase('o1', 'buyer', 'seller', 3_000_00n, 2_850_00n, 'idem-1');
  assert.equal(m.getUser('buyer').balanceCents, 7_000_00n);
  assert.equal(m.ledgerEntries().filter((e) => e.type === 'PURCHASE_HOLD').length, 1);
  m.assertInvariants();
});

test('e2e: complete credits seller payout once and freezes deposit ≤ deal', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 10_000_00n });
  m.ensureUser('seller', { balanceCents: 0n, depositAvailableCents: 5_000_00n });
  m.purchase('o2', 'buyer', 'seller', 4_000_00n, 3_800_00n, 'idem-2');
  m.complete('o2');
  m.complete('o2');
  assert.equal(m.getUser('seller').balanceCents, 3_800_00n);
  assert.equal(m.getUser('seller').depositLockedCents, 4_000_00n);
  assert.equal(m.getUser('seller').depositAvailableCents, 1_000_00n);
  assert.equal(m.ledgerEntries().filter((e) => e.type === 'SALE_PAYOUT').length, 1);
  m.assertInvariants();
});

test('e2e: cancel before complete refunds buyer; seller untouched', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 5_000_00n });
  m.ensureUser('seller', { balanceCents: 100_00n });
  m.purchase('o3', 'buyer', 'seller', 2_000_00n, 1_900_00n, 'idem-3');
  m.refund('o3');
  assert.equal(m.getUser('buyer').balanceCents, 5_000_00n);
  assert.equal(m.getUser('seller').balanceCents, 100_00n);
  m.assertInvariants();
});

test('e2e: post-complete refund clawback from seller then credit buyer', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 5_000_00n });
  m.ensureUser('seller', { balanceCents: 0n, depositAvailableCents: 10_000_00n });
  m.purchase('o4', 'buyer', 'seller', 2_000_00n, 1_900_00n, 'idem-4');
  m.complete('o4');
  assert.equal(m.getUser('seller').balanceCents, 1_900_00n);
  m.refund('o4');
  assert.equal(m.getUser('buyer').balanceCents, 5_000_00n);
  assert.equal(m.getUser('seller').balanceCents, 0n);
  // Deposit freeze released on refund (same as LockService.releaseForOrder).
  assert.equal(m.getUser('seller').depositLockedCents, 0n);
  assert.equal(m.getUser('seller').depositAvailableCents, 10_000_00n);
  m.assertInvariants();
});

test('e2e: deposit withdraw never touches locked collateral', () => {
  const m = new LedgerModel();
  m.ensureUser('s', {
    balanceCents: 0n,
    depositAvailableCents: 3_000_00n,
    depositLockedCents: 7_000_00n,
  });
  m.withdrawDeposit('s', 1_000_00n, 'wd-1');
  assert.equal(m.getUser('s').depositAvailableCents, 2_000_00n);
  assert.equal(m.getUser('s').depositLockedCents, 7_000_00n);
  assert.equal(m.getUser('s').balanceCents, 1_000_00n);
  m.assertInvariants();
});

test('e2e: fund deposit moves main→available only', () => {
  const m = new LedgerModel();
  m.ensureUser('u', { balanceCents: 10_000_00n });
  m.fundDeposit('u', 3_000_00n, 'fd-1');
  assert.equal(m.getUser('u').balanceCents, 7_000_00n);
  assert.equal(m.getUser('u').depositAvailableCents, 3_000_00n);
  assert.equal(m.getUser('u').depositLockedCents, 0n);
  m.assertInvariants();
});

test('e2e: zero payout complete skips SALE_PAYOUT ledger row', () => {
  const m = new LedgerModel();
  m.ensureUser('b', { balanceCents: 1n });
  m.ensureUser('s', { balanceCents: 0n });
  m.purchase('of', 'b', 's', 1n, 0n, 'free-1');
  m.complete('of');
  assert.equal(m.ledgerEntries().filter((e) => e.type === 'SALE_PAYOUT').length, 0);
  assert.equal(m.getUser('s').balanceCents, 0n);
  m.assertInvariants();
});

test('e2e: balanceAfterCents chain is contiguous for a user', () => {
  const m = new LedgerModel();
  m.ensureUser('u', { balanceCents: 1_000_00n });
  m.credit('u', 500_00n, 'DEPOSIT', 'a');
  m.debit('u', 200_00n, 'WITHDRAWAL', 'b');
  m.credit('u', 50_00n, 'REFUND', 'c');
  let running = m.getUser('u').openingBalanceCents;
  for (const row of m.ledgerEntries().filter((e) => e.userId === 'u')) {
    running += row.amountCents;
    assert.equal(row.balanceAfterCents, running);
  }
  assert.equal(m.getUser('u').balanceCents, running);
  m.assertInvariants();
});

test('e2e: 100 buyers / 1 unit — exactly one purchase, 99 rejections', () => {
  const m = new LedgerModel();
  m.ensureUser('seller', { balanceCents: 0n, depositAvailableCents: 10_000_00n });
  m.ensureProduct('sku-1', {
    sellerId: 'seller',
    priceCents: 1_000_00n,
    payoutCents: 950_00n,
    quantity: 1,
  });
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < 100; i++) {
    const buyer = `buyer-${i}`;
    m.ensureUser(buyer, { balanceCents: 5_000_00n });
    try {
      m.purchaseProduct('sku-1', buyer, `idem-buyer-${i}`);
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  assert.equal(ok, 1);
  assert.equal(fail, 99);
  m.assertInvariants();
});

test('e2e: parallel deposit lock same key is idempotent (single lock)', () => {
  const m = new LedgerModel();
  m.ensureUser('s', { depositAvailableCents: 5_000_00n });
  m.lockDeposit('s', 2_000_00n, 'lock-same');
  m.lockDeposit('s', 2_000_00n, 'lock-same');
  assert.equal(m.getUser('s').depositLockedCents, 2_000_00n);
  assert.equal(m.getUser('s').depositAvailableCents, 3_000_00n);
  m.assertInvariants();
});

test('e2e: parallel unlock same key is idempotent', () => {
  const m = new LedgerModel();
  m.ensureUser('s', { depositAvailableCents: 0n, depositLockedCents: 3_000_00n });
  m.unlockDeposit('s', 3_000_00n, 'unlock-same');
  m.unlockDeposit('s', 3_000_00n, 'unlock-same');
  assert.equal(m.getUser('s').depositLockedCents, 0n);
  assert.equal(m.getUser('s').depositAvailableCents, 3_000_00n);
  m.assertInvariants();
});

test('e2e: cancel vs complete — cancel wins when status still PAYMENT_HOLD', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 5_000_00n });
  m.ensureUser('seller', { balanceCents: 0n, depositAvailableCents: 5_000_00n });
  m.purchase('o-race', 'buyer', 'seller', 2_000_00n, 1_900_00n, 'race-key');
  m.refund('o-race'); // cancel path
  assert.throws(() => m.complete('o-race'));
  assert.equal(m.getUser('buyer').balanceCents, 5_000_00n);
  assert.equal(m.getUser('seller').balanceCents, 0n);
  m.assertInvariants();
});

test('e2e: post-complete refund with short seller balance → clawback debt', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 5_000_00n });
  m.ensureUser('seller', { balanceCents: 0n, depositAvailableCents: 10_000_00n });
  m.purchase('o-short', 'buyer', 'seller', 2_000_00n, 1_900_00n, 'short-1');
  m.complete('o-short');
  // Seller spends payout before refund.
  m.debit('seller', 1_500_00n, 'WITHDRAWAL', 'spend-1');
  assert.equal(m.getUser('seller').balanceCents, 400_00n);
  m.refund('o-short');
  assert.equal(m.getUser('buyer').balanceCents, 5_000_00n);
  assert.equal(m.getUser('seller').balanceCents, 0n);
  const cb = m.getClawback('o-short');
  assert.ok(cb);
  assert.equal(cb!.amountCents, 2_000_00n);
  assert.equal(cb!.recoveredCents, 400_00n);
  assert.equal(cb!.status, 'PARTIAL');
  // Later top-up recovers remainder (full total including platform fee).
  m.credit('seller', 2_000_00n, 'DEPOSIT', 'top-1');
  assert.equal(m.recoverClawback('o-short'), 1_600_00n);
  assert.equal(m.getClawback('o-short')!.status, 'RECOVERED');
  assert.equal(m.getUser('seller').balanceCents, 400_00n);
  m.assertInvariants();
});

test('e2e: full deposit→lock→purchase→complete→payout conserves money+fees', () => {
  const total = 4_000_00n;
  const fee = 200_00n;
  const payout = total - fee;
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 10_000_00n });
  m.ensureUser('seller', { balanceCents: 5_000_00n, depositAvailableCents: 0n });
  m.fundDeposit('seller', 5_000_00n, 'fd-1');
  const before = m.getUser('buyer').balanceCents + m.getUser('seller').balanceCents;
  m.purchase('deal-1', 'buyer', 'seller', total, payout, 'deal-idem');
  m.complete('deal-1');
  const after = m.getUser('buyer').balanceCents + m.getUser('seller').balanceCents;
  assert.equal(after + fee, before);
  m.assertInvariants();
});
