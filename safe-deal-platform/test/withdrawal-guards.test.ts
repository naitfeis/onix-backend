import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LedgerModel, MonetaryInvariantError } from '../src/economy/wallet/ledger-model';

const repoFile = (path: string) => readFileSync(path, 'utf8');

test('withdraw serializes per-user: advisory lock + User FOR UPDATE + conditional debit', () => {
  const ops = repoFile('safe-deal-platform/src/operations.module.ts');
  assert.match(ops, /pg_advisory_xact_lock\(hashtextextended\(\$\{`wallet\.user:\$\{user\.id\}`\}/);
  assert.match(ops, /lockUsersInIdOrder\(tx, \[user\.id\]\)/);
  assert.match(ops, /spendableBalanceCents/);
  assert.match(ops, /balanceCents:\s*\{\s*gte:\s*amountCents\s*\}|balance\.debit/);
  assert.match(ops, /idempotencyKey: ledgerKey/);
  assert.match(ops, /wallet\.withdraw:\$\{user\.id\}:\$\{dto\.idempotencyKey\}/);
  assert.match(ops, /withdrawBlockedAt/);
  assert.match(ops, /recoverAllForSeller/);
  assert.match(ops, /hasOpenDebt/);
});

test('withdraw debit uses updateMany gte — second concurrent withdraw cannot overdraft', () => {
  const balance = repoFile('safe-deal-platform/src/economy/wallet/balance.service.ts');
  assert.match(balance, /balanceCents:\s*\{\s*gte:\s*amountCents\s*\}/);
});

test('model: two full-balance withdraws — only one succeeds (no double spend)', () => {
  const m = new LedgerModel();
  m.ensureUser('u', { balanceCents: 1_000_00n });
  m.debit('u', 1_000_00n, 'WITHDRAWAL', 'wd-a');
  assert.throws(
    () => m.debit('u', 1_000_00n, 'WITHDRAWAL', 'wd-b'),
    (err: unknown) => err instanceof MonetaryInvariantError,
  );
  assert.equal(m.getUser('u').balanceCents, 0n);
  assert.equal(m.ledgerEntries().filter((e) => e.type === 'WITHDRAWAL').length, 1);
  m.assertInvariants();
});

test('model: same withdraw key replays; different key after success fails if empty', () => {
  const m = new LedgerModel();
  m.ensureUser('u', { balanceCents: 500_00n });
  m.debit('u', 500_00n, 'WITHDRAWAL', 'same');
  m.debit('u', 500_00n, 'WITHDRAWAL', 'same'); // idempotent replay
  assert.equal(m.getUser('u').balanceCents, 0n);
  assert.throws(() => m.debit('u', 1n, 'WITHDRAWAL', 'other'));
  m.assertInvariants();
});

test('model: withdraw then purchase cannot overspend same balance', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 1_000_00n });
  m.ensureUser('seller', { balanceCents: 0n });
  m.debit('buyer', 1_000_00n, 'WITHDRAWAL', 'wd-1');
  assert.throws(() => m.purchase('o1', 'buyer', 'seller', 1_000_00n, 950_00n, 'buy-1'));
  assert.equal(m.getUser('buyer').balanceCents, 0n);
  m.assertInvariants();
});

test('model: purchase then withdraw cannot overspend', () => {
  const m = new LedgerModel();
  m.ensureUser('buyer', { balanceCents: 1_000_00n });
  m.ensureUser('seller', { balanceCents: 0n });
  m.purchase('o1', 'buyer', 'seller', 1_000_00n, 950_00n, 'buy-1');
  assert.throws(() => m.debit('buyer', 1_000_00n, 'WITHDRAWAL', 'wd-1'));
  assert.equal(m.getUser('buyer').balanceCents, 0n);
  m.assertInvariants();
});

test('FE keeps withdraw idempotency key until success (timeout→retry safe)', () => {
  // The single withdrawal path moved from useOnixCore.withdrawKeyRef to
  // Profile.moneyKeyRef + core.withdraw({ idempotencyKey }). The invariant:
  // one logical withdrawal (one modal session) reuses one key — generated on
  // open, never cleared on failure/step-up, passed verbatim to the API.
  const fe = repoFile('onix-frontend/src/hooks/useOnixCore.ts');
  assert.match(fe, /idempotencyKey: input\.idempotencyKey/);
  assert.doesNotMatch(fe, /idempotencyKey: crypto\.randomUUID\(\)/);

  const profile = repoFile('onix-frontend/src/screens/Profile.tsx');
  // Key is regenerated only when a NEW money modal opens.
  assert.match(profile, /moneyKeyRef\.current = crypto\.randomUUID\(\);\s*\n\s*setMoneyModal\(kind\)/);
  // Submit and the post-step-up retry both reuse the captured key.
  assert.match(profile, /await completeWithdraw\(\{ amountCents, idempotencyKey: key \}\)/);
  assert.match(profile, /idempotencyKey: stepUp\.idempotencyKey/);
  // No failure path resets the key (that would break timeout→retry safety).
  assert.doesNotMatch(profile, /moneyKeyRef\.current = null/);
});
