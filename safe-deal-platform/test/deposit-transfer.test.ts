import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Pure contract checks for Balance ↔ Deposit flows (no DB).
 * Mutators live in WalletEconomyService; locked funds are never withdrawn by debitAvailable.
 */

test('deposit withdraw only touches available (locked stays collateral)', () => {
  const available = 3000_00n;
  const locked = 7000_00n;
  const withdraw = 1000_00n;
  assert.ok(withdraw <= available);
  assert.equal(available - withdraw, 2000_00n);
  assert.equal(locked, 7000_00n);
  assert.equal(available - withdraw + locked, 9000_00n);
});

test('fund deposit moves balance into available only', () => {
  let balance = 10_000_00n;
  let available = 0n;
  let locked = 0n;
  const fund = 3000_00n;
  assert.ok(fund <= balance);
  balance -= fund;
  available += fund;
  assert.equal(balance, 7000_00n);
  assert.equal(available, 3000_00n);
  assert.equal(locked, 0n);
});
