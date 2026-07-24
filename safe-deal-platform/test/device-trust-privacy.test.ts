import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeviceTrustService,
  browserFamilyFromUa,
  osFamilyFromUa,
} from '../src/auth-v2/device-trust.service';
import { securityIpRetentionDays } from '../src/workers/jobs/security-ip-retention.job';

test('browserFamilyFromUa detects common engines', () => {
  assert.equal(browserFamilyFromUa('Mozilla/5.0 Chrome/120.0.0.0'), 'chrome');
  assert.equal(browserFamilyFromUa('Mozilla/5.0 Edg/120.0.0.0'), 'edge');
  assert.equal(browserFamilyFromUa('Mozilla/5.0 Firefox/121.0'), 'firefox');
});

test('osFamilyFromUa detects families', () => {
  assert.equal(osFamilyFromUa('Windows NT 10.0'), 'windows');
  assert.equal(osFamilyFromUa('iPhone; CPU iPhone OS'), 'ios');
  assert.equal(osFamilyFromUa('Macintosh; Intel Mac OS X'), 'macos');
});

test('HMAC deviceId is stable for same stable-ish signals', () => {
  process.env.DEVICE_HMAC_SECRET = 'test-device-secret';
  const trust = new DeviceTrustService();
  const device = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0',
    browser: 'chrome',
    os: 'windows',
    browserId: 'browser-aaa',
    pwaInstallId: 'pwa-bbb',
    timezone: 'Europe/Moscow',
    language: 'ru-RU',
  };
  const a = trust.resolveDeviceId(device);
  const b = trust.resolveDeviceId(device);
  assert.ok(a);
  assert.equal(a, b);
  assert.equal(a!.length, 64);
});

test('HMAC deviceId ignores timezone and locale changes', () => {
  process.env.DEVICE_HMAC_SECRET = 'test-device-secret';
  const trust = new DeviceTrustService();
  const base = {
    browser: 'chrome',
    os: 'windows',
    browserId: 'browser-aaa',
    pwaInstallId: 'pwa-bbb',
  };
  const a = trust.resolveDeviceId({ ...base, timezone: 'UTC', language: 'en-US' });
  const b = trust.resolveDeviceId({ ...base, timezone: 'Europe/Moscow', language: 'ru-RU' });
  assert.ok(a && b);
  assert.equal(a, b);
});

test('HMAC deviceId changes when browserId changes', () => {
  process.env.DEVICE_HMAC_SECRET = 'test-device-secret';
  const trust = new DeviceTrustService();
  const base = {
    browser: 'chrome',
    os: 'windows',
    browserId: 'browser-aaa',
  };
  const a = trust.resolveDeviceId(base);
  const b = trust.resolveDeviceId({ ...base, browserId: 'browser-zzz' });
  assert.ok(a && b);
  assert.notEqual(a, b);
});

test('context signals extracted separately from stable', () => {
  const trust = new DeviceTrustService();
  const coarse = trust.extractCoarseSignals({
    browser: 'chrome',
    os: 'windows',
    browserId: 'b1',
    pwaInstallId: 'p1',
    timezone: 'Europe/Berlin',
    language: 'de-DE',
  });
  assert.equal(coarse.timezone, 'europe/berlin');
  assert.equal(coarse.locale, 'de-de');
  assert.equal(coarse.browserId, 'b1');
  assert.equal(coarse.pwaInstallId, 'p1');
});

test('sanitizeDevice drops canvas/webgl/client fingerprintHash', () => {
  const trust = new DeviceTrustService();
  const clean = trust.sanitizeDevice({
    browserId: 'x',
    canvasHash: 'canvas-should-go',
    webglHash: 'webgl-should-go',
    fingerprintHash: 'client-hash-ignored',
    timezone: 'UTC',
  });
  assert.equal(clean.canvasHash, undefined);
  assert.equal(clean.webglHash, undefined);
  assert.equal(clean.fingerprintHash, undefined);
  assert.equal(clean.browserId, 'x');
  const id = trust.resolveDeviceId({
    browserId: 'x',
    timezone: 'UTC',
    language: 'en',
    fingerprintHash: 'client-hash-ignored',
    canvasHash: 'canvas',
  });
  const id2 = trust.resolveDeviceId({
    browserId: 'x',
    timezone: 'UTC',
    language: 'en',
  });
  assert.equal(id, id2);
});

test('production requires DEVICE_HMAC_SECRET at startup (no JWT_SECRET fallback)', () => {
  const prevNode = process.env.NODE_ENV;
  const prevDevice = process.env.DEVICE_HMAC_SECRET;
  const prevJwt = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  delete process.env.DEVICE_HMAC_SECRET;
  process.env.JWT_SECRET = 'should-not-be-used-in-prod-for-device';
  assert.throws(() => new DeviceTrustService(), /DEVICE_HMAC_SECRET/);
  if (prevNode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNode;
  if (prevDevice === undefined) delete process.env.DEVICE_HMAC_SECRET;
  else process.env.DEVICE_HMAC_SECRET = prevDevice;
  if (prevJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = prevJwt;
});

test('securityIpRetentionDays respects env band', () => {
  const prev = process.env.SECURITY_IP_RETENTION_DAYS;
  process.env.SECURITY_IP_RETENTION_DAYS = '90';
  assert.equal(securityIpRetentionDays(), 90);
  process.env.SECURITY_IP_RETENTION_DAYS = '0';
  assert.equal(securityIpRetentionDays(), 120);
  if (prev === undefined) delete process.env.SECURITY_IP_RETENTION_DAYS;
  else process.env.SECURITY_IP_RETENTION_DAYS = prev;
});
