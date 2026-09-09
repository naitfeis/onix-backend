import assert from 'node:assert/strict';
import test from 'node:test';
import { canActAsSupport, isStaffViewer, type AuthUser } from '../src/common';
import { isStaffPlatformStatus } from '../src/platform-status';

function user(partial: Partial<AuthUser>): AuthUser {
  return {
    id: 1n,
    telegramId: 1n,
    onixId: 'ONIX-1',
    isAdmin: false,
    isSupport: false,
    ...partial,
  };
}

test('isStaffPlatformStatus covers MODERATOR/ADMIN/SUPER_ADMIN only', () => {
  assert.equal(isStaffPlatformStatus('USER'), false);
  assert.equal(isStaffPlatformStatus('VIP'), false);
  assert.equal(isStaffPlatformStatus('MODERATOR'), true);
  assert.equal(isStaffPlatformStatus('ADMIN'), true);
  assert.equal(isStaffPlatformStatus('SUPER_ADMIN'), true);
});

test('isStaffViewer prefers platformStatus when flags are stale', () => {
  assert.equal(isStaffViewer(user({ platformStatus: 'MODERATOR' })), true);
  assert.equal(isStaffViewer(user({ platformStatus: 'SUPER_ADMIN' })), true);
  assert.equal(isStaffViewer(user({ platformStatus: 'USER' })), false);
  assert.equal(isStaffViewer(user({ isSupport: true, platformStatus: 'USER' })), true);
});

test('canActAsSupport only via adminEscrow bridge (not platformStatus)', () => {
  assert.equal(canActAsSupport(user({ platformStatus: 'ADMIN' })), false);
  assert.equal(canActAsSupport(user({ isAdmin: true, isSupport: true })), false);
  assert.equal(canActAsSupport(user({ adminEscrow: true })), true);
  assert.equal(canActAsSupport(user({})), false);
});
