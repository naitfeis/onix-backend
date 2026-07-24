import assert from 'node:assert/strict';
import test from 'node:test';
import { clientAvatarUrl, isAllowedTelegramAvatarHost, publicAvatarUrl } from '../src/avatars/avatar-url';

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
  assert.equal(isAllowedTelegramAvatarHost('api.telegram.org'), true);
  assert.equal(isAllowedTelegramAvatarHost('evil.example'), false);
});
