import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAdminIpAllowed,
  parseAdminIpAllowlist,
} from '../src/admin/admin-ip-allowlist';
import { assessSecrets } from '../src/auth-v2/secrets-inventory';

test('parseAdminIpAllowlist: empty → null (not enforced)', () => {
  assert.equal(parseAdminIpAllowlist(undefined), null);
  assert.equal(parseAdminIpAllowlist(''), null);
  assert.equal(parseAdminIpAllowlist('  ,  '), null);
});

test('parseAdminIpAllowlist: comma-separated IPs', () => {
  const list = parseAdminIpAllowlist('1.2.3.4, 5.6.7.8;9.9.9.9');
  assert.deepEqual(list, ['1.2.3.4', '5.6.7.8', '9.9.9.9']);
});

test('isAdminIpAllowed: no allowlist permits any IP', () => {
  assert.equal(isAdminIpAllowed(null, null), true);
  assert.equal(isAdminIpAllowed('8.8.8.8', null), true);
});

test('isAdminIpAllowed: enforces exact match when configured', () => {
  const list = ['203.0.113.10', '2001:db8::1'];
  assert.equal(isAdminIpAllowed('203.0.113.10', list), true);
  assert.equal(isAdminIpAllowed('203.0.113.11', list), false);
  assert.equal(isAdminIpAllowed(null, list), false);
  assert.equal(isAdminIpAllowed('2001:db8::1', list), true);
});

test('isAdminIpAllowed: normalizes IPv4-mapped and ports', () => {
  const list = parseAdminIpAllowlist('10.0.0.5')!;
  assert.equal(isAdminIpAllowed('::ffff:10.0.0.5', list), true);
  assert.equal(isAdminIpAllowed('10.0.0.5:443', list), true);
});

test('secrets inventory lists ADMIN_IP_ALLOWLIST as optional admin domain', () => {
  const items = assessSecrets({ NODE_ENV: 'production' }, 'production');
  const row = items.find((i) => i.name === 'ADMIN_IP_ALLOWLIST');
  assert.ok(row);
  assert.equal(row!.required, false);
  assert.equal(row!.domain, 'admin');
  assert.equal(row!.status, 'missing');
});
