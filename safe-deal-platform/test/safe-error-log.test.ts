import assert from 'node:assert/strict';
import test from 'node:test';
import { formatErrorForLog, redactSecrets } from '../src/safe-error-log';

test('redactSecrets strips Bearer Authorization values', () => {
  const raw = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature';
  const out = redactSecrets(raw);
  assert.equal(out.includes('eyJ'), false);
  assert.match(out, /\[REDACTED\]/);
});

test('redactSecrets strips JWT-shaped access tokens', () => {
  const jwt = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiI3In0.signaturepart';
  assert.equal(redactSecrets(`token=${jwt}`).includes(jwt), false);
});

test('redactSecrets strips refresh cookies', () => {
  const raw = 'Cookie: __Host-onix_rt=opaque-refresh-secret; Path=/';
  const out = redactSecrets(raw);
  assert.equal(out.includes('opaque-refresh-secret'), false);
  assert.match(out, /\[REDACTED\]/);
});

test('redactSecrets strips PEM private keys', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nABC123SECRET\n-----END PRIVATE KEY-----';
  const out = redactSecrets(`failed key ${pem}`);
  assert.equal(out.includes('ABC123SECRET'), false);
  assert.match(out, /\[REDACTED\]/);
});

test('formatErrorForLog redacts secrets in Error message and stack', () => {
  const err = new Error('bad Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb');
  err.stack = `Error: bad Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb\n    at test`;
  const out = formatErrorForLog(err);
  assert.equal(out.includes('eyJhbGciOiJIUzI1NiJ9'), false);
  assert.match(out, /\[REDACTED\]/);
});
