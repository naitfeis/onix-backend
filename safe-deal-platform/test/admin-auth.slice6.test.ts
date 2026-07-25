import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashMfaCode, hashPassword, mintMfaCode, verifyPassword,
} from '../src/admin/admin-crypto';
import {
  ADMIN_ACCESS_AUD, ADMIN_ACCESS_ISS, ADMIN_ACCESS_TYP,
} from '../src/admin/admin-token.service';
import {
  adminRefreshCookieName,
  buildAdminRefreshCookieHeader,
  readAdminRefreshTokenFromCookie,
} from '../src/admin/admin-cookie';

test('admin password hash verifies', () => {
  const stored = hashPassword('correct-horse-battery');
  assert.equal(verifyPassword('correct-horse-battery', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
});

test('admin MFA code hash is stable and distinct', () => {
  const code = mintMfaCode();
  assert.match(code, /^\d{6}$/);
  assert.equal(hashMfaCode(code), hashMfaCode(code));
  assert.notEqual(hashMfaCode(code), hashMfaCode('000000'));
});

test('admin token constants isolate plane from customer JWT', () => {
  assert.equal(ADMIN_ACCESS_TYP, 'admin_access');
  assert.equal(ADMIN_ACCESS_AUD, 'onix-admin');
  assert.equal(ADMIN_ACCESS_ISS, 'onix-admin-api');
});

test('admin refresh cookie is separate from customer cookie name', () => {
  const prev = process.env.AUTH_COOKIE_SECURE;
  process.env.AUTH_COOKIE_SECURE = 'false';
  try {
    assert.equal(adminRefreshCookieName(), 'onix_admin_rt');
    const header = buildAdminRefreshCookieHeader('tok', 3600);
    assert.match(header, /^onix_admin_rt=/);
    assert.match(header, /SameSite=Strict/);
    assert.equal(readAdminRefreshTokenFromCookie('onix_admin_rt=tok; other=1'), 'tok');
  } finally {
    if (prev === undefined) delete process.env.AUTH_COOKIE_SECURE;
    else process.env.AUTH_COOKIE_SECURE = prev;
  }
});
