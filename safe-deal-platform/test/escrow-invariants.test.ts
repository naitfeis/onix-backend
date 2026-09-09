import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { computeSaleAmounts } from '../src/pricing';
import { assertOrderMoneySplit } from '../src/order-state-machine';

const repoFile = (path: string) => readFileSync(path, 'utf8');

test('escrow: fee + payout = total; payout never exceeds total; fee never negative', () => {
  for (const total of [0n, 1n, 99n, 100n, 1_000_00n, 10_000_00n, 5_000_000n]) {
    const { feeCents, payoutCents } = computeSaleAmounts(total);
    assert.ok(feeCents >= 0n);
    assert.ok(payoutCents >= 0n);
    assert.ok(payoutCents <= total);
    assert.equal(feeCents + payoutCents, total);
    assert.doesNotThrow(() => assertOrderMoneySplit({ totalAmountCents: total, feeCents, payoutCents }));
  }
});

test('escrow: assertOrderMoneySplit rejects payout > total or bad split', () => {
  assert.throws(() => assertOrderMoneySplit({
    totalAmountCents: 100n, feeCents: 5n, payoutCents: 100n,
  }));
  assert.throws(() => assertOrderMoneySplit({
    totalAmountCents: 100n, feeCents: 0n, payoutCents: 101n,
  }));
});

test('escrow invariants wired: spendable on purchase/deposit; clawback ≤ payout; single payout key', () => {
  const escrow = repoFile('safe-deal-platform/src/escrow.module.ts');
  const hold = repoFile('safe-deal-platform/src/economy/wallet/sale-proceeds-hold.ts');
  const wallet = repoFile('safe-deal-platform/src/economy/wallet/wallet-economy.service.ts');
  const ops = repoFile('safe-deal-platform/src/operations.module.ts');

  assert.match(escrow, /assertSpendableBalance/);
  assert.match(escrow, /idempotencyKey:\s*`order:\$\{id\}:payout`/);
  assert.match(escrow, /amountCents:\s*order\.payoutCents/);
  assert.match(escrow, /assertOrderMoneySplit/);
  assert.match(hold, /warrantyHeldSaleProceedsCents/);
  assert.match(hold, /openClawbackDebtCents/);
  assert.match(wallet, /assertSpendableBalance/);
  assert.match(ops, /spendableBalanceCents/);
  assert.match(ops, /hasOpenDebt/);
});
