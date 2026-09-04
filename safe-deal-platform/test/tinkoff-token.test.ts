import assert from 'node:assert/strict';
import test from 'node:test';
import { tinkoffCredentials, tinkoffToken } from '../src/economy/payments/tinkoff.provider';

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
