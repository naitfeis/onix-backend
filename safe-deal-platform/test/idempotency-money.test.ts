import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LedgerModel } from '../src/economy/wallet/ledger-model';

const repoFile = (path: string) => readFileSync(path, 'utf8');

/**
 * Senior guard: timeout → client retry must not double-apply money.
 * Escrow money keys are order/client scoped inside the same Serializable TX as the mutation.
 */
test('purchase / complete / refund / cancel ledger keys are order-scoped and unique', () => {
  const escrow = repoFile('safe-deal-platform/src/escrow.module.ts');
  assert.match(escrow, /idempotencyKey: `order:\$\{key\}:hold`/);
  assert.match(escrow, /idempotencyKey: `order:\$\{id\}:payout`/);
  assert.match(escrow, /const ledgerKey = `order:\$\{id\}:\$\{target\.toLowerCase\(\)\}`/);
  assert.match(escrow, /const key = `order:\$\{id\}:admin-refund`/);
  assert.match(escrow, /const key = `order:\$\{id\}:admin-complete`/);
  assert.match(escrow, /orderTransition\.findUnique\(\{ where: \{ idempotencyKey: key \} \}\)/);
});

test('withdraw uses transactional idempotency (claim + debit in one TX)', () => {
  const ops = repoFile('safe-deal-platform/src/operations.module.ts');
  assert.match(ops, /idempotency\.runTransactional\(/);
  assert.match(ops, /'wallet\.withdraw'/);
});

test('deposit fund\/withdraw replay via deposit ledger unique key inside Serializable TX', () => {
  const wallet = repoFile('safe-deal-platform/src/economy/wallet/wallet-economy.service.ts');
  assert.match(wallet, /depositLedgerEntry\.findUnique\(\{ where: \{ idempotencyKey \} \}\)/);
  assert.match(wallet, /idempotencyKey: `bal:\$\{idempotencyKey\}`/);
  assert.match(wallet, /withSerializableTransaction/);
});

test('payment settle uses runTransactional so webhook retry cannot double-credit', () => {
  const payments = repoFile('safe-deal-platform/src/economy/payments/payments.service.ts');
  assert.match(payments, /idempotency\.runTransactional\(/);
  assert.match(payments, /idempotencyKey: `payment:\$\{intent\.id\}:main`/);
});

test('model: complete then retry complete does not double payout', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 10_000_00n });
  m.ensureUser('seller', { balanceCents: 0n, depositAvailableCents: 10_000_00n });
  m.purchase('o1', 'buyer', 'seller', 1_000_00n, 950_00n, 'buy-1');
  m.complete('o1');
  const afterFirst = m.getUser('seller').balanceCents;
  m.complete('o1'); // replay / already completed
  assert.equal(m.getUser('seller').balanceCents, afterFirst);
  assert.equal(afterFirst, 950_00n);
  m.assertInvariants();
});

test('model: refund then retry refund does not double credit buyer', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 5_000_00n });
  m.ensureUser('seller', { balanceCents: 0n, depositAvailableCents: 5_000_00n });
  m.purchase('o2', 'buyer', 'seller', 1_000_00n, 950_00n, 'buy-2');
  m.refund('o2');
  assert.equal(m.getUser('buyer').balanceCents, 5_000_00n);
  m.refund('o2');
  assert.equal(m.getUser('buyer').balanceCents, 5_000_00n);
  m.assertInvariants();
});

test('model: same purchase idempotency key does not double debit', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 5_000_00n });
  m.ensureUser('seller', { balanceCents: 0n });
  m.purchase('o3', 'buyer', 'seller', 1_000_00n, 950_00n, 'same-key');
  m.purchase('o3', 'buyer', 'seller', 1_000_00n, 950_00n, 'same-key');
  assert.equal(m.getUser('buyer').balanceCents, 4_000_00n);
  m.assertInvariants();
});

test('model: post-complete refund then retry keeps single clawback', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 5_000_00n });
  m.ensureUser('seller', { balanceCents: 0n, depositAvailableCents: 10_000_00n });
  m.purchase('o4', 'buyer', 'seller', 2_000_00n, 1_900_00n, 'buy-4');
  m.complete('o4');
  m.refund('o4');
  m.refund('o4');
  assert.equal(m.getUser('buyer').balanceCents, 5_000_00n);
  assert.equal(m.getUser('seller').balanceCents, 0n);
  const cb = m.getClawback('o4');
  assert.ok(cb);
  assert.equal(cb!.amountCents, 1_900_00n);
  m.assertInvariants();
});
