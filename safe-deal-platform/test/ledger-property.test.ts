import assert from 'node:assert/strict';
import test from 'node:test';
import * as fc from 'fast-check';
import { LedgerModel, MonetaryInvariantError } from '../src/economy/wallet/ledger-model';

/** Deterministic bigint cents in [1, 50_000_00]. */
const centsArb = fc.integer({ min: 1, max: 50_000_00 }).map((n) => BigInt(n));

test('property: random credit/debit sequences never violate ledger invariants', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.oneof(
          fc.record({ kind: fc.constant('credit' as const), amount: centsArb }),
          fc.record({ kind: fc.constant('debit' as const), amount: centsArb }),
          fc.record({ kind: fc.constant('fundDeposit' as const), amount: centsArb }),
          fc.record({ kind: fc.constant('withdrawDeposit' as const), amount: centsArb }),
        ),
        { minLength: 1, maxLength: 40 },
      ),
      (ops) => {
        const m = new LedgerModel();
        m.ensureUser('u1', { balanceCents: 100_000_00n, depositAvailableCents: 20_000_00n });
        let i = 0;
        for (const op of ops) {
          const key = `k-${i++}`;
          try {
            if (op.kind === 'credit') m.credit('u1', op.amount, 'DEPOSIT', key);
            else if (op.kind === 'debit') m.debit('u1', op.amount, 'WITHDRAWAL', key);
            else if (op.kind === 'fundDeposit') m.fundDeposit('u1', op.amount, key);
            else m.withdrawDeposit('u1', op.amount, key);
          } catch (err) {
            if (!(err instanceof MonetaryInvariantError)) throw err;
            // insufficient funds etc. are allowed — invariants must still hold
          }
          m.assertInvariants();
        }
      },
    ),
    { numRuns: 100 },
  );
});

test('property: idempotent replay does not change balances', () => {
  fc.assert(
    fc.property(centsArb, (amount) => {
      const m = new LedgerModel();
      m.ensureUser('u1', { balanceCents: amount + 10n });
      m.debit('u1', amount, 'WITHDRAWAL', 'same-key');
      const after = m.getUser('u1').balanceCents;
      m.debit('u1', amount, 'WITHDRAWAL', 'same-key');
      assert.equal(m.getUser('u1').balanceCents, after);
      m.assertInvariants();
    }),
    { numRuns: 50 },
  );
});

test('property: escrow purchase→complete→refund conserves buyer+seller+fee', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 100, max: 100_000_00 }),
      fc.integer({ min: 0, max: 20 }),
      (totalNum, feePct) => {
        const total = BigInt(totalNum);
        const fee = (total * BigInt(feePct)) / 100n;
        const payout = total - fee;
        const m = new LedgerModel();
        m.ensureUser('buyer', { balanceCents: total + 1_000_00n });
        m.ensureUser('seller', { balanceCents: 0n, depositAvailableCents: total });
        const before =
          m.getUser('buyer').balanceCents
          + m.getUser('seller').balanceCents;
        m.purchase('1', 'buyer', 'seller', total, payout, 'ord-a');
        m.complete('1');
        // System holds fee off-ledger (platform revenue) — seller has payout, buyer reduced by total.
        const afterComplete =
          m.getUser('buyer').balanceCents
          + m.getUser('seller').balanceCents;
        assert.equal(afterComplete + fee, before);
        m.refund('1');
        // After clawback refund: buyer restored; seller back; fee still "with platform" if it was never credited.
        // Our model never credits fee to anyone — conservation: buyer+seller == before - fee + fee? 
        // On refund after complete: clawback payout from seller, credit total to buyer.
        // Net: buyer back to start; seller 0; fee never existed as balance → buyer+seller == before.
        const afterRefund =
          m.getUser('buyer').balanceCents
          + m.getUser('seller').balanceCents;
        assert.equal(afterRefund, before);
        m.assertInvariants();
      },
    ),
    { numRuns: 80 },
  );
});

test('property: deposit lock/unlock preserves deposit total', () => {
  fc.assert(
    fc.property(centsArb, (amount) => {
      const m = new LedgerModel();
      m.ensureUser('s', { depositAvailableCents: amount + 5n, depositLockedCents: 0n });
      const totalBefore = m.getUser('s').depositAvailableCents + m.getUser('s').depositLockedCents;
      m.lockDeposit('s', amount, 'lock-1');
      const mid = m.getUser('s');
      assert.equal(mid.depositAvailableCents + mid.depositLockedCents, totalBefore);
      m.unlockDeposit('s', amount, 'unlock-1');
      const end = m.getUser('s');
      assert.equal(end.depositAvailableCents + end.depositLockedCents, totalBefore);
      m.assertInvariants();
    }),
    { numRuns: 50 },
  );
});

test('property: conflicting idempotency payload is rejected', () => {
  const m = new LedgerModel();
  m.ensureUser('u', { balanceCents: 10_000_00n });
  m.credit('u', 100n, 'DEPOSIT', 'k1');
  assert.throws(() => m.credit('u', 200n, 'DEPOSIT', 'k1'), MonetaryInvariantError);
});
