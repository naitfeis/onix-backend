import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSafeAvatarUrl,
  clientAvatarUrl,
  isAllowedTelegramAvatarHost,
  isBlockedAvatarIpLiteral,
  publicAvatarUrl,
  AVATAR_ALLOWED_TYPES,
} from '../src/avatars/avatar-url';

test('publicAvatarUrl is same-origin proxy path', () => {
  assert.equal(publicAvatarUrl(1n), '/api/avatars/1');
  assert.equal(publicAvatarUrl('42'), '/api/avatars/42');
});

test('clientAvatarUrl always returns proxy (never raw t.me)', () => {
  assert.equal(clientAvatarUrl(7n, 'https://t.me/i/userpic/320/x.jpg'), '/api/avatars/7');
  assert.equal(clientAvatarUrl(7n, null), '/api/avatars/7');
});

test('isAllowedTelegramAvatarHost allowlist', () => {
  assert.equal(isAllowedTelegramAvatarHost('t.me'), true);
  assert.equal(isAllowedTelegramAvatarHost('cdn4.telesco.pe'), true);
  assert.equal(isAllowedTelegramAvatarHost('api.telegram.org'), true);
  assert.equal(isAllowedTelegramAvatarHost('evil.example'), false);
});

test('assertSafeAvatarUrl blocks SSRF targets', () => {
  assert.equal(assertSafeAvatarUrl('https://t.me/i/userpic/320/x.jpg')?.hostname, 't.me');
  assert.equal(assertSafeAvatarUrl('http://t.me/x'), null);
  assert.equal(assertSafeAvatarUrl('https://evil.example/x'), null);
  assert.equal(assertSafeAvatarUrl('https://127.0.0.1/x'), null);
  assert.equal(assertSafeAvatarUrl('https://169.254.169.254/latest'), null);
  assert.equal(isBlockedAvatarIpLiteral('127.0.0.1'), true);
});

test('avatar allowlist types exclude svg', () => {
  assert.equal(AVATAR_ALLOWED_TYPES.has('image/jpeg'), true);
  assert.equal(AVATAR_ALLOWED_TYPES.has('image/svg+xml'), false);
});
