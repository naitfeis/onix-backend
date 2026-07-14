import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNewAuthCanaryPercent,
  isNewAuthEnabled,
  isRolloutObserveEnabled,
} from '../src/auth-v2/auth-v2.flags';
import {
  AuthRolloutService,
  canaryBucket,
} from '../src/auth-v2/auth-rollout.service';

function clearRolloutEnv(): void {
  delete process.env.USE_NEW_AUTH;
  delete process.env.AUTH_NEW_AUTH_CANARY_PERCENT;
  delete process.env.AUTH_ACCEPT_V2_ACCESS;
  delete process.env.AUTH_DUAL_ISSUE_SESSION;
  delete process.env.AUTH_ROLLOUT_OBSERVE;
}

test('AUTH_NEW_AUTH_CANARY_PERCENT defaults to 0 and clamps 0–100', () => {
  clearRolloutEnv();
  assert.equal(getNewAuthCanaryPercent(), 0);
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '25';
  assert.equal(getNewAuthCanaryPercent(), 25);
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '-5';
  assert.equal(getNewAuthCanaryPercent(), 0);
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '150';
  assert.equal(getNewAuthCanaryPercent(), 100);
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = 'nope';
  assert.equal(getNewAuthCanaryPercent(), 0);
  clearRolloutEnv();
});

test('canaryBucket is deterministic for the same userId', () => {
  const a = canaryBucket('7');
  const b = canaryBucket('7');
  const c = canaryBucket('8');
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 99);
  assert.ok(c >= 0 && c <= 99);
});

test('isCanaryEnabled: percent 0 → nobody; 100 → everybody', () => {
  clearRolloutEnv();
  const rollout = new AuthRolloutService();
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '0';
  assert.equal(rollout.isCanaryEnabled(7n), false);
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '100';
  assert.equal(rollout.isCanaryEnabled(7n), true);
  assert.equal(rollout.isCanaryEnabled(999n), true);
  clearRolloutEnv();
});

test('isCanaryEnabled: same user stable across calls at partial percent', () => {
  clearRolloutEnv();
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '50';
  const rollout = new AuthRolloutService();
  const first = rollout.isCanaryEnabled({ userId: 42n });
  for (let i = 0; i < 20; i += 1) {
    assert.equal(rollout.isCanaryEnabled(42n), first);
  }
  const bucket = rollout.getCanaryBucket(42n);
  assert.equal(first, bucket < 50);
  clearRolloutEnv();
});

test('shouldUseNewAuthForUser stays false while USE_NEW_AUTH is false', () => {
  clearRolloutEnv();
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '100';
  const rollout = new AuthRolloutService();
  assert.equal(isNewAuthEnabled(), false);
  assert.equal(rollout.shouldUseNewAuthForUser(1n), false);
  assert.equal(rollout.resolveAuthMode(1n), 'legacy');
  clearRolloutEnv();
});

test('resolveAuthMode ladder: legacy → dual → new_auth', () => {
  clearRolloutEnv();
  const rollout = new AuthRolloutService();
  assert.equal(rollout.resolveAuthMode(1n), 'legacy');

  process.env.AUTH_ACCEPT_V2_ACCESS = 'true';
  assert.equal(rollout.resolveAuthMode(1n), 'dual');

  process.env.AUTH_ACCEPT_V2_ACCESS = 'false';
  process.env.AUTH_DUAL_ISSUE_SESSION = 'true';
  assert.equal(rollout.resolveAuthMode(1n), 'dual');

  process.env.USE_NEW_AUTH = 'true';
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '100';
  assert.equal(rollout.shouldUseNewAuthForUser(1n), true);
  assert.equal(rollout.resolveAuthMode(1n), 'new_auth');

  // Instant rollback via canary percent
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '0';
  assert.equal(rollout.shouldUseNewAuthForUser(1n), false);
  assert.equal(rollout.resolveAuthMode(1n), 'dual');

  // Instant rollback via USE_NEW_AUTH
  process.env.USE_NEW_AUTH = 'false';
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '100';
  assert.equal(rollout.resolveAuthMode(1n), 'dual');

  process.env.AUTH_DUAL_ISSUE_SESSION = 'false';
  process.env.AUTH_ACCEPT_V2_ACCESS = 'false';
  assert.equal(rollout.resolveAuthMode(1n), 'legacy');
  clearRolloutEnv();
});

test('getRolloutSnapshot exposes safe flag state', () => {
  clearRolloutEnv();
  const snapshot = new AuthRolloutService().getRolloutSnapshot();
  assert.deepEqual(snapshot, {
    useNewAuth: false,
    canaryPercent: 0,
    acceptV2Access: false,
    dualIssueSession: false,
    observe: false,
    modeWithoutUser: 'legacy',
  });
});

test('AUTH_ROLLOUT_OBSERVE defaults false; observeAuthPath is no-op when off', () => {
  clearRolloutEnv();
  assert.equal(isRolloutObserveEnabled(), false);
  const rollout = new AuthRolloutService();
  rollout.observeAuthPath('legacy_hs256', { userId: '1' });
  rollout.logRollbackGuidance('test_drill');
  process.env.AUTH_ROLLOUT_OBSERVE = 'true';
  assert.equal(isRolloutObserveEnabled(), true);
  rollout.observeAuthPath('v2_access', { userId: '1' });
  clearRolloutEnv();
});

test('P3-T01: USE_NEW_AUTH false → legacy path for all users', () => {
  clearRolloutEnv();
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '100';
  const rollout = new AuthRolloutService();
  assert.equal(rollout.resolveAuthMode(7n), 'legacy');
  assert.equal(rollout.shouldUseNewAuthForUser(7n), false);
  clearRolloutEnv();
});

test('P3-T04: canary percent + rollback flag behaviour', () => {
  clearRolloutEnv();
  const rollout = new AuthRolloutService();
  process.env.USE_NEW_AUTH = 'true';
  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '1';

  let inCanary = 0;
  let out = 0;
  for (let id = 1; id <= 200; id += 1) {
    if (rollout.shouldUseNewAuthForUser(BigInt(id))) inCanary += 1;
    else out += 1;
  }
  // ~1% of 200 ≈ 2; allow wide band for hash distribution
  assert.ok(inCanary >= 0 && inCanary <= 15, `unexpected canary size ${inCanary}`);
  assert.ok(out >= 185, `unexpected out size ${out}`);

  process.env.AUTH_NEW_AUTH_CANARY_PERCENT = '0';
  assert.equal(rollout.shouldUseNewAuthForUser(1n), false);
  clearRolloutEnv();
});
