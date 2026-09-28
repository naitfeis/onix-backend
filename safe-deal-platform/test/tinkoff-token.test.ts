import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  tinkoffCredentials,
  tinkoffIsSandbox,
  tinkoffToken,
} from '../src/economy/payments/tinkoff.provider';

test('tinkoff Token is SHA256 of sorted scalar fields plus Password', () => {
  const token = tinkoffToken(
    { TerminalKey: 'DemoTerminal', Amount: 10000, OrderId: 'ord-1', Nested: { skip: true } },
    'secret',
  );
  assert.equal(token.length, 64);
  const again = tinkoffToken(
    { Amount: 10000, OrderId: 'ord-1', TerminalKey: 'DemoTerminal' },
    'secret',
  );
  assert.equal(token, again);
});

test('tinkoff credentials stay off without env', () => {
  assert.equal(tinkoffCredentials({}), null);
  assert.ok(tinkoffCredentials({
    TINKOFF_TERMINAL_KEY: 'term',
    TINKOFF_PASSWORD: 'pass',
  }));
});

test('sandbox flag defaults to live, never silently claims test mode', () => {
  // The flag feeds a buyer-facing "no real money is charged" notice, so an unset
  // value must read as live. Defaulting to sandbox was the silent trap.
  assert.equal(tinkoffIsSandbox({}), false);
  assert.equal(tinkoffIsSandbox({ TINKOFF_SANDBOX: '' }), false);
  assert.equal(tinkoffIsSandbox({ TINKOFF_SANDBOX: '   ' }), false);
  assert.equal(tinkoffIsSandbox({ TINKOFF_SANDBOX: 'false' }), false);
  assert.equal(tinkoffIsSandbox({ TINKOFF_SANDBOX: 'garbage' }), false);
  assert.equal(tinkoffIsSandbox({ TINKOFF_SANDBOX: '0' }), false);
  assert.equal(tinkoffIsSandbox({ TINKOFF_SANDBOX: 'no' }), false);
});

test('sandbox flag accepts the affirmative spellings used by other toggles', () => {
  for (const value of ['true', 'TRUE', 'True', '1', 'yes', 'YES']) {
    assert.equal(tinkoffIsSandbox({ TINKOFF_SANDBOX: value }), true, value);
  }
  for (const value of [' true ', ' 1 ']) {
    assert.equal(tinkoffIsSandbox({ TINKOFF_SANDBOX: value }), true, JSON.stringify(value));
  }
});

test('sandbox flag is read from one place, not duplicated per call site', () => {
  // Two copies of the env expression drifted before: provider metadata and
  // paymentMethodsPublic. Both must go through tinkoffIsSandbox now.
  const provider = readFileSync(
    'safe-deal-platform/src/economy/payments/tinkoff.provider.ts',
    'utf8',
  );
  const payments = readFileSync(
    'safe-deal-platform/src/economy/payments/payments.service.ts',
    'utf8',
  );
  assert.match(provider, /sandbox: tinkoffIsSandbox\(\)/);
  assert.match(payments, /sandbox: tinkoffIsSandbox\(\)/);
  const stale = /process\.env\.TINKOFF_SANDBOX \?\? 'true'/;
  assert.doesNotMatch(provider, stale);
  assert.doesNotMatch(payments, stale);
});
