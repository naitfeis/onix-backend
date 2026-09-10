import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ADMIN_COMPLETE_FROM,
  BUYER_CANCEL_FROM,
  BUYER_COMPLETE_FROM,
  DISPUTE_FROM,
  ORDER_TERMINAL,
  REFUND_FROM,
  SELLER_DELIVER_FROM,
  assertNotTerminalForMutation,
  assertStatusIn,
} from '../src/order-state-machine';

const repoFile = (path: string) => readFileSync(path, 'utf8');

test('state machine: buyer cannot complete from PAYMENT_HOLD; admin can', () => {
  assert.deepEqual(BUYER_COMPLETE_FROM, ['DELIVERING']);
  assert.deepEqual(ADMIN_COMPLETE_FROM, ['PAYMENT_HOLD', 'DELIVERING', 'DISPUTE']);
  assert.equal(ADMIN_COMPLETE_FROM.includes('PAYMENT_HOLD'), true);
  const escrow = repoFile('safe-deal-platform/src/escrow.module.ts');
  assert.match(escrow, /ADMIN_COMPLETE_FROM/);
});

test('state machine: buyer cancel removed; deliver only from PAYMENT_HOLD', () => {
  assert.deepEqual(BUYER_CANCEL_FROM, []);
  assert.equal(SELLER_DELIVER_FROM, 'PAYMENT_HOLD');
});

test('state machine: dispute only from PAYMENT_HOLD|DELIVERING', () => {
  assert.deepEqual([...DISPUTE_FROM].sort(), ['DELIVERING', 'PAYMENT_HOLD']);
});

test('state machine: refund allowed set excludes CANCELED/REFUNDED as sources', () => {
  assert.equal(REFUND_FROM.includes('CANCELED'), false);
  assert.equal(REFUND_FROM.includes('REFUNDED'), false);
  assert.ok(REFUND_FROM.includes('COMPLETED'));
});

test('assert helpers reject terminal and illegal sources', () => {
  for (const status of ORDER_TERMINAL) {
    assert.throws(() => assertNotTerminalForMutation(status, 'deliver'));
  }
  assert.throws(() => assertStatusIn('PAYMENT_HOLD', BUYER_COMPLETE_FROM, 'complete'));
  assert.throws(() => assertStatusIn('DELIVERING', BUYER_CANCEL_FROM, 'cancel'));
  assert.throws(() => assertStatusIn('COMPLETED', BUYER_CANCEL_FROM, 'cancel'));
  assert.throws(() => assertStatusIn('REFUNDED', ADMIN_COMPLETE_FROM, 'complete'));
  assert.doesNotThrow(() => assertStatusIn('PAYMENT_HOLD', ADMIN_COMPLETE_FROM, 'complete'));
  assert.doesNotThrow(() => assertStatusIn('DELIVERING', BUYER_COMPLETE_FROM, 'complete'));
  assert.doesNotThrow(() => assertStatusIn('DISPUTE', ADMIN_COMPLETE_FROM, 'complete'));
});

test('closed-ticket guard requires terminal order', () => {
  const guard = repoFile('safe-deal-platform/src/support-ticket-guard.ts');
  assert.match(guard, /OPEN_ORDER_STATUSES/);
});
