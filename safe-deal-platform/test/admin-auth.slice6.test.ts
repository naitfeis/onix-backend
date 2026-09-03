import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  hashMfaCode, hashPassword, mintMfaCode, mintStaffPassword, verifyPassword,
} from '../src/admin/admin-crypto';
import { adminIpResumeEnabled } from '../src/admin/admin-auth.service';
import {
  ADMIN_ACCESS_AUD, ADMIN_ACCESS_ISS, ADMIN_ACCESS_TYP,
} from '../src/admin/admin-token.service';
import {
  adminRefreshCookieName,
  buildAdminRefreshCookieHeader,
  readAdminRefreshTokenFromCookie,
} from '../src/admin/admin-cookie';
import { AdminAccessGuard, AdminRoleGuard } from '../src/admin/admin.guard';
import { AuthPlatformError } from '../src/auth-v2/auth-errors';
import { AdminPlaneController } from '../src/admin/admin.controller';
import { EconomyController } from '../src/economy/economy.controller';
import { PaymentsService } from '../src/economy/payments/payments.service';

test('admin password hash verifies', () => {
  const stored = hashPassword('correct-horse-battery');
  assert.equal(verifyPassword('correct-horse-battery', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
});

test('staff password generator is long enough', () => {
  const password = mintStaffPassword();
  assert.ok(password.length >= 16);
});

test('admin IP resume is off unless ADMIN_IP_RESUME=true', () => {
  const prev = process.env.ADMIN_IP_RESUME;
  try {
    delete process.env.ADMIN_IP_RESUME;
    assert.equal(adminIpResumeEnabled(), false);
    process.env.ADMIN_IP_RESUME = 'true';
    assert.equal(adminIpResumeEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_IP_RESUME;
    else process.env.ADMIN_IP_RESUME = prev;
  }
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

test('admin role guard permits only configured admin roles', () => {
  const guard = new AdminRoleGuard({
    getAllAndOverride: () => ['SECURITY_ADMIN'],
  } as never);
  const contextFor = (role: string) => ({
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({
        admin: {
          id: 1n,
          email: 'ops@example.com',
          role,
          sessionId: 'session-1',
        },
      }),
    }),
  } as unknown as ExecutionContext);

  assert.equal(guard.canActivate(contextFor('SECURITY_ADMIN')), true);
  assert.throws(
    () => guard.canActivate(contextFor('SUPPORT_ADMIN')),
    /Недостаточно прав admin-роли/,
  );
});

test('admin access guard rejects a customer JWT', async () => {
  let received = '';
  const guard = new AdminAccessGuard({
    validateAccess: async (token: string) => {
      received = token;
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Customer JWT is not an admin access token.');
    },
  } as never);
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: 'Bearer customer.jwt.token' } }),
    }),
  } as unknown as ExecutionContext;

  await assert.rejects(() => guard.canActivate(context), /Customer JWT is not an admin access token/);
  assert.equal(received, 'customer.jwt.token');
});

test('admin role matrix separates support, security and finance', () => {
  const contextFor = (role: string) => ({
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => ({ admin: { id: 1n, email: 'a@b.c', role, sessionId: 's' } }) }),
  } as unknown as ExecutionContext);
  const guardFor = (roles: string[]) => new AdminRoleGuard({
    getAllAndOverride: () => roles,
  } as never);

  assert.equal(guardFor(['SUPER_ADMIN', 'SUPPORT_ADMIN']).canActivate(contextFor('SUPPORT_ADMIN')), true);
  assert.throws(() => guardFor(['SUPER_ADMIN', 'SUPPORT_ADMIN']).canActivate(contextFor('SECURITY_ADMIN')));
  assert.equal(guardFor(['SUPER_ADMIN', 'FINANCE_ADMIN']).canActivate(contextFor('FINANCE_ADMIN')), true);
  assert.throws(() => guardFor(['SUPER_ADMIN', 'SECURITY_ADMIN']).canActivate(contextFor('FINANCE_ADMIN')));
});

test('PRO and MANUAL admin endpoints enforce the separated role matrix', () => {
  const reflector = new Reflector();
  const contextFor = (handler: (...args: never[]) => unknown, role: string) => ({
    getHandler: () => handler,
    getClass: () => AdminPlaneController,
    switchToHttp: () => ({
      getRequest: () => ({
        admin: { id: 1n, email: 'admin@example.com', role, sessionId: 'session-1' },
      }),
    }),
  } as unknown as ExecutionContext);
  const guard = new AdminRoleGuard(reflector);

  assert.equal(guard.canActivate(contextFor(AdminPlaneController.prototype.grantPro, 'SUPER_ADMIN')), true);
  assert.throws(
    () => guard.canActivate(contextFor(AdminPlaneController.prototype.grantPro, 'FINANCE_ADMIN')),
    /Недостаточно прав admin-роли/,
  );
  assert.equal(guard.canActivate(contextFor(AdminPlaneController.prototype.createManualPayment, 'FINANCE_ADMIN')), true);
  assert.equal(guard.canActivate(contextFor(AdminPlaneController.prototype.confirmManualPayment, 'SUPER_ADMIN')), true);
  assert.throws(
    () => guard.canActivate(contextFor(AdminPlaneController.prototype.confirmManualPayment, 'SUPPORT_ADMIN')),
    /Недостаточно прав admin-роли/,
  );
});

test('customer plane rejects MANUAL even for legacy admin customer claims', async () => {
  const payments = new PaymentsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await assert.rejects(
    () => payments.createTopUp(
      { id: 9n, telegramId: 99n, onixId: '000009', isAdmin: true, isSupport: true },
      { wallet: 'MAIN', amountCents: 500, provider: 'MANUAL', idempotencyKey: 'customer-manual-key' },
    ),
    /admin control plane/,
  );
  assert.equal('confirmIntent' in EconomyController.prototype, false);
});
