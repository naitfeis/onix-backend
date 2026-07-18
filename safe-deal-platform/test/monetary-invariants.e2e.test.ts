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
  // Deposit freeze stays (platform policy) — locked not auto-released on refund.
  assert.equal(m.getUser('seller').depositLockedCents, 2_000_00n);
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
