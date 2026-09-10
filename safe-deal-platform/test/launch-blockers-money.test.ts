import assert from 'node:assert/strict';
import test from 'node:test';
import { LedgerModel, MonetaryInvariantError } from '../src/economy/wallet/ledger-model';
import { readFileSync } from 'node:fs';

/**
 * Contended money paths — pure model mirrors DB optimistic locks
 * (product qty gte, balance gte, idempotency). DB-backed races remain
 * ops gate on Neon scratch; these prove the invariant logic under contention.
 */

test('concurrent: two buyers on qty=1 — exactly one winner', () => {
  const m = new LedgerModel();
  m.ensureProduct('p1', {
    sellerId: 'seller',
    priceCents: 1_000_00n,
    payoutCents: 950_00n,
    quantity: 1,
  });
  m.ensureUser('b1', { balanceCents: 5_000_00n });
  m.ensureUser('b2', { balanceCents: 5_000_00n });
  m.ensureUser('seller', { balanceCents: 0n });

  const results: Array<{ ok: true; orderId: string } | { ok: false }> = [];
  for (const [buyer, key] of [['b1', 'k1'], ['b2', 'k2']] as const) {
    try {
      const orderId = m.purchaseProduct('p1', buyer, key);
      results.push({ ok: true, orderId });
    } catch (err) {
      assert.ok(err instanceof MonetaryInvariantError);
      results.push({ ok: false });
    }
  }
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => !r.ok).length, 1);
  // product qty exhausted
  assert.throws(() => m.purchaseProduct('p1', 'b1', 'k3'));
  m.assertInvariants();
});

test('concurrent: same withdraw idempotency key — single debit', () => {
  const m = new LedgerModel();
  m.ensureUser('u', { balanceCents: 2_000_00n });
  m.debit('u', 2_000_00n, 'WITHDRAWAL', 'wd-same');
  m.debit('u', 2_000_00n, 'WITHDRAWAL', 'wd-same');
  assert.equal(m.getUser('u').balanceCents, 0n);
  assert.equal(m.ledgerEntries().filter((e) => e.type === 'WITHDRAWAL').length, 1);
  m.assertInvariants();
});

test('concurrent: admin adjust during payout — idempotent keys keep single credit', () => {
  const m = new LedgerModel();
  m.ensureUser('seller', { balanceCents: 0n });
  m.credit('seller', 1_000_00n, 'SALE_PAYOUT', 'order:9:payout');
  m.credit('seller', 1_000_00n, 'SALE_PAYOUT', 'order:9:payout'); // replay
  m.credit('seller', 100_00n, 'ADMIN_ADJUSTMENT', 'admin:adj:1');
  m.credit('seller', 100_00n, 'ADMIN_ADJUSTMENT', 'admin:adj:1'); // replay
  assert.equal(m.getUser('seller').balanceCents, 1_100_00n);
  assert.equal(m.ledgerEntries().filter((e) => e.type === 'SALE_PAYOUT').length, 1);
  assert.equal(m.ledgerEntries().filter((e) => e.type === 'ADMIN_ADJUSTMENT').length, 1);
  m.assertInvariants();
});

test('clawback: full withdraw then refund leaves OPEN debt and blocks withdraw', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 5_000_00n });
  m.ensureUser('seller', { balanceCents: 0n, depositAvailableCents: 5_000_00n });
  m.purchase('o1', 'buyer', 'seller', 2_000_00n, 1_900_00n, 'buy');
  m.complete('o1');
  m.debit('seller', 1_900_00n, 'WITHDRAWAL', 'wd-all');
  assert.equal(m.getUser('seller').balanceCents, 0n);
  m.refund('o1');
  const cb = m.getClawback('o1');
  assert.ok(cb);
  assert.equal(cb!.status, 'OPEN');
  assert.equal(cb!.recoveredCents, 0n);
  assert.equal(m.getUser('buyer').balanceCents, 5_000_00n); // platform float
  assert.equal(m.hasOpenClawbackDebt('seller'), true);
  assert.throws(() => m.assertCanWithdraw('seller'));
  m.credit('seller', 2_000_00n, 'DEPOSIT', 'top');
  assert.equal(m.recoverClawback('o1'), 1_900_00n);
  assert.equal(m.hasOpenClawbackDebt('seller'), false);
  m.assertCanWithdraw('seller');
  m.assertInvariants();
});

test('source: holdForDispute re-freezes RELEASED and creates pre-complete lock', () => {
  const lock = readFileSync('safe-deal-platform/src/economy/wallet/lock.service.ts', 'utf8');
  assert.match(lock, /RELEASED/);
  assert.match(lock, /deposit-relock:dispute/);
  assert.match(lock, /deposit-lock:dispute/);
  assert.match(lock, /HELD_DISPUTE/);
});

test('source: origin guard wired in main bootstrap', () => {
  const main = readFileSync('safe-deal-platform/src/main.ts', 'utf8');
  assert.match(main, /originAccessMiddleware/);
});

test('source: clawback debt flags withdrawBlockedAt + SecurityEvent', () => {
  const claw = readFileSync('safe-deal-platform/src/economy/wallet/clawback.service.ts', 'utf8');
  assert.match(claw, /flagClawbackDebt/);
  assert.match(claw, /withdrawBlockedAt/);
  assert.match(claw, /CLAWBACK_DEBT/);
  assert.match(claw, /clearClawbackDebtFlagIfClean/);
});
