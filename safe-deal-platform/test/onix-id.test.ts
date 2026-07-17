import assert from 'node:assert/strict';
import test from 'node:test';
import { formatOnixId, onixIdLookupCandidates } from '../src/onix-id';

test('formatOnixId strips leading zeros', () => {
  assert.equal(formatOnixId('ONIX-000001'), 'ONIX-1');
  assert.equal(formatOnixId('ONIX-000025'), 'ONIX-25');
  assert.equal(formatOnixId('ONIX-100'), 'ONIX-100');
  assert.equal(formatOnixId('ONIX-1000000'), 'ONIX-1000000');
});

test('onixIdLookupCandidates accepts short and padded', () => {
  const a = onixIdLookupCandidates('1');
  assert.ok(a.includes('ONIX-1'));
  assert.ok(a.includes('ONIX-000001'));
  const b = onixIdLookupCandidates('ONIX-152');
  assert.ok(b.includes('ONIX-152'));
  assert.ok(b.includes('ONIX-000152'));
});
