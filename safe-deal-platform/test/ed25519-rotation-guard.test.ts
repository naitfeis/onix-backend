import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accessTtlSeconds,
  assertMayRetirePrevious,
  minRetirePreviousMinutes,
} from '../src/auth-v2/ed25519-rotation-guard';

test('ed25519 retire guard refuses drops before access TTL window', () => {
  const env = { AUTH_ACCESS_TTL_SECONDS: '900' };
  assert.equal(accessTtlSeconds(env), 900);
  assert.equal(minRetirePreviousMinutes(env), 15);
  assert.throws(() => assertMayRetirePrevious(14, env), /Refusing to retire PREVIOUS/);
  assert.doesNotThrow(() => assertMayRetirePrevious(15, env));
  assert.doesNotThrow(() => assertMayRetirePrevious(60, env));
});

test('ed25519 retire guard scales with AUTH_ACCESS_TTL_SECONDS', () => {
  const env = { AUTH_ACCESS_TTL_SECONDS: '3600' };
  assert.equal(minRetirePreviousMinutes(env), 60);
  assert.throws(() => assertMayRetirePrevious(59, env), />=60/);
});
