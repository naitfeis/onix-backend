import assert from 'node:assert/strict';
import test from 'node:test';
import { decideAction, RISK_WEIGHT, scoreFactors } from '../src/risk/risk-engine.scoring';
import { RiskEngineService } from '../src/risk/risk-engine.service';
import type { RiskFactor } from '../src/risk/risk-engine.types';

/**
 * "A fraudster must not be able to cheat the same person twice."
 *
 * The pair-level gate lives in assertPurchaseAllowed: once an order between this
 * buyer and this seller was REFUNDED (the platform proved non-delivery), any further
 * purchase between the SAME pair is refused outright.
 */

function fakeDb(state: {
  refunded?: { id: bigint } | null;
  owed?: { id: bigint } | null;
}) {
  const events: Array<{ type: string; payload: unknown }> = [];
  const db = {
    user: { findUnique: async () => ({ suspiciousFundsHoldAt: null, securityLockedAt: null }) },
    session: { findMany: async () => [] },
    order: {
      findFirst: async (args: { where?: { clawback?: unknown } }) =>
        // The relation-filtered call is the clawback-debt lookup; the plain one is REFUNDED.
        (args?.where?.clawback ? state.owed ?? null : state.refunded ?? null),
    },
    securityEvent: {
      create: async (args: { data: { type: string; payload: unknown } }) => {
        events.push({ type: args.data.type, payload: args.data.payload });
        return {};
      },
    },
  };
  return { db: db as never, events };
}

test('REPEAT_VICTIM hard-blocks and is scored above the lock threshold', () => {
  const factors: RiskFactor[] = ['REPEAT_VICTIM'];
  assert.equal(scoreFactors(factors), RISK_WEIGHT.REPEAT_VICTIM);
  assert.equal(decideAction(scoreFactors(factors), factors), 'BLOCK');
  // Combined with anything else it must stay a BLOCK.
  assert.equal(decideAction(100, ['REPEAT_VICTIM', 'LARGE_AMOUNT']), 'BLOCK');
});

test('purchase is refused when this seller already refunded this buyer', async () => {
  const { db, events } = fakeDb({ refunded: { id: 4001n } });
  const engine = new RiskEngineService(db);
  await assert.rejects(
    () => engine.assertPurchaseAllowed(7n, 1000n, db, 9n),
    (error: unknown) => {
      const err = error as { code?: string; message?: string; details?: { reason?: string } };
      assert.equal(err.code, 'AUTH_ACCOUNT_LOCKED');
      assert.equal(err.details?.reason, 'REPEAT_VICTIM');
      assert.match(err.message ?? '', /возврат/i, 'the buyer is told why');
      return true;
    },
    'a second deal with a seller who already failed this buyer must be refused',
  );
  assert.equal(events.length, 1, 'exactly one fraud event for support review');
  assert.equal(events[0]!.type, 'FRAUD_ATTEMPT');
});

test('purchase is refused while the seller still owes this buyer a clawback', async () => {
  // REFUNDED may be historical, but unrecovered debt on the pair is still live harm.
  const { db } = fakeDb({ refunded: null, owed: { id: 4002n } });
  const engine = new RiskEngineService(db);
  await assert.rejects(
    () => engine.assertPurchaseAllowed(7n, 1000n, db, 9n),
    (error: unknown) => (error as { details?: { reason?: string } }).details?.reason === 'REPEAT_VICTIM',
  );
});

test('a clean pair is NOT blocked', async () => {
  const { db, events } = fakeDb({ refunded: null, owed: null });
  const engine = new RiskEngineService(db);
  await engine.assertPurchaseAllowed(7n, 1000n, db, 9n);
  assert.equal(events.length, 0, 'no fraud event for an innocent pair');
});

test('omitting sellerId keeps the legacy behaviour (no pair gate)', async () => {
  // Other callers do not know the counterparty; the gate must not fire on guesses.
  const { db } = fakeDb({ refunded: { id: 4003n } });
  const engine = new RiskEngineService(db);
  await engine.assertPurchaseAllowed(7n, 1000n, db);
});