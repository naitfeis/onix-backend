import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import { RiskEngineService } from '../src/risk/risk-engine.service';
import { RiskScoreService } from '../src/risk-score.service';
import { DeviceTrustService } from '../src/auth-v2/device-trust.service';
import { RISK_WEIGHT } from '../src/risk/risk-engine.scoring';

/** Mirrors RiskScoreService.hashValue so expectations match production hashing. */
function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 64);
}

/**
 * Regression guard for the ban-evasion paths. Each fake DB answers exactly what
 * production answers, so an assertion proves the real code path is reachable.
 *
 * These two invariants were both broken before this file existed: BAN_EVASION was
 * gated on a signal that could never be produced, and the registration score could
 * never reach its own BLOCK_SCORE with the markers production actually writes.
 */

/** user.findMany is required: the evasion check queries banned telegram twins. */
function fakeDb(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: async () => ({ telegramId: 555n, securityLockedAt: null }),
      findMany: async () => [],
    },
    session: { findMany: async () => [] },
    abuseMarker: {
      findMany: async () => [],
      createMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
    },
    securityEvent: { create: async () => ({}) },
    identityLink: { findMany: async () => [] },
    ...overrides,
  } as never;
}

test('BAN_EVASION fires when a banned account used the same device and IP', async () => {
  const db = fakeDb({
    session: { findMany: async () => [{ user: { onixId: 'ONIX-000001' } }] },
  });
  const engine = new RiskEngineService(db);
  const result = await engine.collectBanEvasionFactors(999n, {
    deviceId: 'device-of-banned-user',
    ipAddress: '1.2.3.4',
    telegramId: 555n,
  }, db);

  assert.ok(result.factors.includes('BAN_EVASION'), `factors=${JSON.stringify(result.factors)}`);
  assert.ok(result.reasons.includes('device seen on banned account'));
  assert.ok(result.reasons.includes('ip seen on banned account'));
  assert.ok(result.bannedAccounts.length > 0);
  // BAN_EVASION alone must be enough to BLOCK: weight 70 >= RISK_LOCK_SCORE (70).
  assert.ok(RISK_WEIGHT.BAN_EVASION >= 70, 'weight keeps BAN_EVASION at or above the lock threshold');
});

test('BAN_EVASION fires on device identity alone — the durable signal', async () => {
  // A banned fraudster who moves to a VPN keeps the same browser/device identity.
  const db = fakeDb({
    session: {
      findMany: async (args: { where?: { fingerprintHash?: unknown } }) =>
        args?.where?.fingerprintHash ? [{ user: { onixId: 'ONIX-000002' } }] : [],
    },
  });
  const engine = new RiskEngineService(db);
  const result = await engine.collectBanEvasionFactors(999n, {
    deviceId: 'device-of-banned-user',
    ipAddress: '8.8.8.8',
    telegramId: 555n,
  }, db);
  assert.ok(result.factors.includes('BAN_EVASION'), `factors=${JSON.stringify(result.factors)}`);
});

test('IP alone does NOT raise BAN_EVASION — mobile CGNAT is shared', async () => {
  // Blocking on a shared carrier IP would lock out innocent users on the same tower.
  const db = fakeDb({
    session: {
      findMany: async (args: { where?: { ipAddress?: unknown } }) =>
        args?.where?.ipAddress ? [{ user: { onixId: 'ONIX-000003' } }] : [],
    },
  });
  const engine = new RiskEngineService(db);
  const result = await engine.collectBanEvasionFactors(999n, {
    deviceId: null,
    ipAddress: '1.2.3.4',
    telegramId: 555n,
  }, db);
  assert.ok(!result.factors.includes('BAN_EVASION'), `factors=${JSON.stringify(result.factors)}`);
  assert.ok(result.reasons.includes('ip seen on banned account'), 'still recorded as a reason for review');
});

/**
 * Server-derived deviceId, computed exactly like production does: the same four
 * stable signals DeviceTrustService hashes. Keeping this literal pins the test to
 * the real derivation instead of re-implementing it loosely.
 */
function derivedDeviceId(): string {
  const canonical = ['chrome', 'windows', 'browser-id', 'pwa-1'].join('|');
  return createHmac('sha256', 'test-device-hmac-secret')
    .update(canonical, 'utf8')
    .digest('hex')
    .slice(0, 64);
}

function deviceTrust(): DeviceTrustService {
  return new DeviceTrustService({ get: () => 'test-device-hmac-secret' } as never);
}

/** The realistic re-registration of a banned fraudster: same device, new Telegram. */
const sameDevice = {
  browser: 'chrome',
  os: 'windows',
  browserId: 'browser-id',
  pwaInstallId: 'pwa-1',
  ipAddress: '1.2.3.4',
  userAgent: 'Mozilla/5.0',
  fingerprintHash: null,
};

test('registration blocks when device + IP + user agent match a banned account', async () => {
  // recordBanMarkers writes FINGERPRINT from Session.fingerprintHash — the server
  // deviceId. With the same browser/pwa storage ids, the derived deviceId matches.
  const markers = [
    { kind: 'FINGERPRINT' as const, valueHash: hash(derivedDeviceId()), sourceUserId: 1n },
    { kind: 'IP' as const, valueHash: hash('1.2.3.4'), sourceUserId: 1n },
    { kind: 'USER_AGENT' as const, valueHash: hash('Mozilla/5.0'), sourceUserId: 1n },
  ];
  const db = fakeDb({
    abuseMarker: {
      findMany: async () => markers,
      createMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
    },
  });
  const result = await new RiskScoreService(deviceTrust()).assertNewRegistrationAllowed(db, {
    telegramId: 777n,
    device: sameDevice,
  }).then(
    (value) => ({ blocked: false, ...value }),
    () => ({ blocked: true, score: 0, factors: [] }),
  );
  assert.ok(result.blocked, 'a banned fraudster on the same device must not re-register');
});

test('registration is NOT blocked by IP + user agent alone', async () => {
  // Corroborates MIN_FACTORS intent: a shared carrier IP and a common UA string are
  // not evidence of a specific fraudster. FINGERPRINT + IP = 40 + 15 = 55 blocks;
  // IP + UA = 25 must not.
  const markers = [
    { kind: 'IP' as const, valueHash: hash('1.2.3.4'), sourceUserId: 1n },
    { kind: 'USER_AGENT' as const, valueHash: hash('Mozilla/5.0'), sourceUserId: 1n },
  ];
  const db = fakeDb({
    abuseMarker: {
      findMany: async () => markers,
      createMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
    },
  });
  const result = await new RiskScoreService(deviceTrust()).assertNewRegistrationAllowed(db, {
    telegramId: 779n,
    device: sameDevice,
  });
  assert.equal(result.score, 25, `expected IP+UA only, got ${result.score}`);
});

test('registration blocks on device fingerprint alone plus one weak signal', async () => {
  // A fraudster who switched networks (new IP) but kept the same browser/pwa ids.
  const markers = [
    { kind: 'FINGERPRINT' as const, valueHash: hash(derivedDeviceId()), sourceUserId: 1n },
    { kind: 'TELEGRAM_ID' as const, valueHash: hash('777'), sourceUserId: 1n },
  ];
  const db = fakeDb({
    abuseMarker: {
      findMany: async () => markers,
      createMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
    },
  });
  await assert.rejects(
    () => new RiskScoreService(deviceTrust()).assertNewRegistrationAllowed(db, {
      telegramId: 777n,
      device: { ...sameDevice, ipAddress: '9.9.9.9' },
    }),
    (error: unknown) => (error as { code?: string }).code === 'AUTH_ACCOUNT_LOCKED',
    'device identity + telegram id (40 + 45) must block even on a fresh IP',
  );
});

test('a single weak signal (IP only) never blocks registration', async () => {
  // MIN_FACTORS = 2 must survive the retune: one shared IP is not evidence.
  const db = fakeDb({
    abuseMarker: {
      findMany: async () => [{ kind: 'IP' as const, valueHash: 'h-ip', sourceUserId: 1n }],
      createMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
    },
  });
  const result = await new RiskScoreService().assertNewRegistrationAllowed(db, {
    telegramId: 778n,
    device: { browserId: 'browser-id', ipAddress: '1.2.3.4', userAgent: 'Mozilla/5.0' },
  });
  assert.equal(result.factors.length, 1, `factors=${JSON.stringify(result.factors)}`);
  assert.ok(result.score < 50, `score must stay below BLOCK_SCORE, got ${result.score}`);
});