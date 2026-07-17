import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicDisplayName } from '../src/public-username';

test('publicDisplayName uses displayName, never telegram nick', () => {
  assert.equal(publicDisplayName('Иван', 'ONIX-000007'), 'Иван');
  assert.equal(publicDisplayName('Max Shop', 'ONIX-7'), 'Max Shop');
});

test('publicDisplayName falls back to ONIX id', () => {
  assert.equal(publicDisplayName(null, 'ONIX-000007'), 'ONIX-7');
  assert.equal(publicDisplayName('', 'ONIX-000042'), 'ONIX-42');
  assert.equal(publicDisplayName('123456789', 'ONIX-000007'), 'ONIX-7');
  assert.equal(publicDisplayName('ONIX-99', 'ONIX-000007'), 'ONIX-7');
});
