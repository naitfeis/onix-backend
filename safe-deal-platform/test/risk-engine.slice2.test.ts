import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthPlatformError } from '../src/auth-v2/auth-errors';
import {
  applyStepUpPolicy,
  decideAction,
  largeWithdrawCents,
  RISK_WEIGHT,
  scoreFactors,
} from '../src/risk/risk-engine.scoring';
import { RiskEngineService, riskEnforcementMode } from '../src/risk/risk-engine.service';
import type { RiskFactor } from '../src/risk/risk-engine.types';

test('scoreFactors sums unique weights and caps at 100', () => {
  const factors: RiskFactor[] = ['NEW_DEVICE', 'NEW_IP', 'NEW_DEVICE'];
  assert.equal(scoreFactors(factors), RISK_WEIGHT.NEW_DEVICE + RISK_WEIGHT.NEW_IP);
  const heavy: RiskFactor[] = [
    'NEW_DEVICE', 'NEW_IP', 'NEW_COUNTRY', 'LARGE_AMOUNT', 'NEW_PAYOUT_DEST', 'HIGH_SESSION_RISK', 'CONTEXT_SHIFT',
  ];
  assert.equal(scoreFactors(heavy), 100);
});

test('CONTEXT_SHIFT alone never decides STEP_UP', () => {
  const factors: RiskFactor[] = ['CONTEXT_SHIFT'];
  const score = scoreFactors(factors);
  assert.equal(decideAction(score, factors), 'ALLOW');
  // Even if score artificially high:
  assert.equal(decideAction(80, ['CONTEXT_SHIFT']), 'MONITOR');
});

test('NEW_DEVICE + NEW_IP reaches STEP_UP', () => {
  const factors: RiskFactor[] = ['NEW_DEVICE', 'NEW_IP'];
  const score = scoreFactors(factors);
  assert.ok(score >= 50);
  assert.equal(decideAction(score, factors), 'STEP_UP');
});

test('LARGE_AMOUNT alone reaches STEP_UP (Slice 3 withdraw gate)', () => {
  const factors: RiskFactor[] = ['LARGE_AMOUNT'];
  const score = scoreFactors(factors);
  assert.equal(score, RISK_WEIGHT.LARGE_AMOUNT);
  assert.ok(score >= 50);
  assert.equal(decideAction(score, factors), 'STEP_UP');
  assert.equal(applyStepUpPolicy('STEP_UP'), 'STEP_UP');
});

test('RISK_STEP_UP_ENFORCE=false demotes STEP_UP to MONITOR', () => {
  const prev = process.env.RISK_STEP_UP_ENFORCE;
  process.env.RISK_STEP_UP_ENFORCE = 'false';
  assert.equal(applyStepUpPolicy('STEP_UP'), 'MONITOR');
  if (prev === undefined) delete process.env.RISK_STEP_UP_ENFORCE;
  else process.env.RISK_STEP_UP_ENFORCE = prev;
});

test('largeWithdrawCents reads env', () => {
  const prev = process.env.RISK_WITHDRAW_LARGE_CENTS;
  process.env.RISK_WITHDRAW_LARGE_CENTS = '100000';
  assert.equal(largeWithdrawCents(), 100000n);
  if (prev === undefined) delete process.env.RISK_WITHDRAW_LARGE_CENTS;
  else process.env.RISK_WITHDRAW_LARGE_CENTS = prev;
});

/**
 * evaluateLogin runs collectBanEvasionFactors, which fails CLOSED on lookup errors,
 * so the fake must answer both queries the way production does:
 * - history lookup (where has no `user` relation filter) returns prior sessions;
 * - ban-evasion lookup (where filters `user` on banned/deleted) selects user.onixId
 *   and returns [] when no banned account shares the signal.
 */
function loginPrismaFake(sessionRows: unknown[] = []) {
  return {
    user: { findUnique: async () => null, findMany: async () => [] },
    session: {
      findMany: async (args?: { where?: Record<string, unknown> }) => {
        if (args?.where && 'user' in args.where) return [];
        return sessionRows;
      },
    },
  };
}

test('evaluateLogin: first session ALLOW, no events', async () => {
  const prisma = loginPrismaFake([]);
  const engine = new RiskEngineService(prisma as never);
  const result = await engine.evaluateLogin({
    userId: 1n,
    deviceId: 'dev-a',
    ipAddress: '1.1.1.1',
    country: 'RU',
    timezone: 'Europe/Moscow',
    locale: 'ru',
    trustedDevice: false,
  }, prisma as never);
  assert.equal(result.action, 'ALLOW');
  assert.equal(result.events.length, 0);
  assert.equal(result.factors.length, 0);
});

test('evaluateLogin: new device+IP → MONITOR events (login never STEP_UP)', async () => {
  const prisma = loginPrismaFake([{
    fingerprintHash: 'old-dev',
    ipAddress: '9.9.9.9',
    country: 'RU',
    timezone: 'Europe/Moscow',
    language: 'ru',
  }]);
  const engine = new RiskEngineService(prisma as never);
  const result = await engine.evaluateLogin({
    userId: 1n,
    deviceId: 'new-dev',
    ipAddress: '1.1.1.1',
    country: 'DE',
    timezone: 'Europe/Berlin',
    locale: 'de',
    trustedDevice: false,
  }, prisma as never);
  assert.ok(result.factors.includes('NEW_DEVICE'));
  assert.ok(result.factors.includes('NEW_IP'));
  assert.ok(result.factors.includes('NEW_COUNTRY'));
  assert.ok(result.factors.includes('CONTEXT_SHIFT'));
  assert.equal(result.action, 'MONITOR');
  assert.ok(result.events.length >= 1);
  assert.equal(result.events[0]?.type, 'IMPOSSIBLE_TRAVEL');
});

test('assertWithdrawAllowed: STEP_UP throws AUTH_STEP_UP_REQUIRED', async () => {
  process.env.RISK_STEP_UP_ENFORCE = 'true';
  process.env.RISK_WITHDRAW_LARGE_CENTS = '1000';
  const events: unknown[] = [];
  const prisma = {
    // assertWithdrawAllowed also runs the fail-closed debt + ban-evasion gates.
    user: {
      findUnique: async () => ({ balanceCents: 0n, securityLockedAt: null, telegramId: null }),
      findMany: async () => [],
    },
    orderClawback: { findMany: async () => [] },
    session: {
      findFirst: async () => ({
        id: 'sess-1',
        fingerprintHash: 'brand-new',
        ipAddress: '8.8.8.8',
        country: 'US',
        timezone: 'UTC',
        language: 'en',
        riskScore: 50,
      }),
      findMany: async () => [{
        fingerprintHash: 'known',
        ipAddress: '1.1.1.1',
        country: 'RU',
      }],
    },
    trustedDevice: { findFirst: async () => null },
    auditLog: { findMany: async () => [] },
    securityEvent: {
      create: async ({ data }: { data: unknown }) => {
        events.push(data);
        return data;
      },
    },
  };
  const engine = new RiskEngineService(prisma as never);
  await assert.rejects(
    () => engine.assertWithdrawAllowed({
      userId: 1n,
      amountCents: 50_000n,
      sessionId: 'sess-1',
    }, prisma as never),
    (err: unknown) => err instanceof AuthPlatformError && err.code === 'AUTH_STEP_UP_REQUIRED',
  );
  assert.ok(events.length >= 1);
  delete process.env.RISK_WITHDRAW_LARGE_CENTS;
});

test('locale/timezone change does not change withdraw score without other factors', async () => {
  // Scoring unit: CONTEXT_SHIFT weight alone is below MONITOR
  assert.ok(RISK_WEIGHT.CONTEXT_SHIFT < 25);
});

test('RISK_ENFORCEMENT_MODE defaults invalid values to live', () => {
  assert.equal(riskEnforcementMode(undefined), 'live');
  assert.equal(riskEnforcementMode('unexpected'), 'live');
  assert.equal(riskEnforcementMode(' SHADOW '), 'shadow');
});

test('shadow lock writes queryable event without applyLock or user-facing throw', async () => {
  const previous = process.env.RISK_ENFORCEMENT_MODE;
  process.env.RISK_ENFORCEMENT_MODE = 'shadow';
  const events: any[] = [];
  let applyCalls = 0;
  const prisma = {
    securityEvent: {
      create: async ({ data }: { data: unknown }) => {
        events.push(data);
        return data;
      },
    },
  };
  const locks = {
    applyLock: async () => { applyCalls += 1; },
  };
  const engine = new RiskEngineService(prisma as never, undefined, locks as never);
  const enforce = engine as unknown as {
    enforceBlockLock(
      userId: bigint,
      factors: RiskFactor[],
      score: number,
      eventType: string,
    ): Promise<boolean>;
  };
  try {
    assert.equal(await enforce.enforceBlockLock(1n, ['BAN_EVASION'], 95, 'LOGIN'), false);
    assert.equal(applyCalls, 0);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].payload, {
      kind: 'RISK_ENFORCEMENT_SHADOW',
      enforcementMode: 'shadow',
      shadowMode: true,
      wouldHaveLocked: true,
      wouldHaveLockedLevel: 'CRITICAL',
      score: 95,
      factors: ['BAN_EVASION'],
      eventType: 'LOGIN',
      reasons: ['BAN_EVASION', 'score=95'],
    });
  } finally {
    if (previous === undefined) delete process.env.RISK_ENFORCEMENT_MODE;
    else process.env.RISK_ENFORCEMENT_MODE = previous;
  }
});

test('live lock calls applyLock and throws user-facing block', async () => {
  const previous = process.env.RISK_ENFORCEMENT_MODE;
  process.env.RISK_ENFORCEMENT_MODE = 'live';
  let applyCalls = 0;
  const locks = {
    applyLock: async () => {
      applyCalls += 1;
      return { locked: true };
    },
  };
  const engine = new RiskEngineService({} as never, undefined, locks as never);
  const enforce = engine as unknown as {
    enforceBlockLock(
      userId: bigint,
      factors: RiskFactor[],
      score: number,
      eventType: string,
    ): Promise<boolean>;
  };
  try {
    await assert.rejects(
      () => enforce.enforceBlockLock(1n, ['BAN_EVASION'], 95, 'LOGIN'),
      (error: unknown) => error instanceof AuthPlatformError && error.code === 'AUTH_SECURITY_LOCK',
    );
    assert.equal(applyCalls, 1);
  } finally {
    if (previous === undefined) delete process.env.RISK_ENFORCEMENT_MODE;
    else process.env.RISK_ENFORCEMENT_MODE = previous;
  }
});

test('shadow mode still enforces a pre-existing security lock before evaluation', async () => {
  const previous = process.env.RISK_ENFORCEMENT_MODE;
  process.env.RISK_ENFORCEMENT_MODE = 'shadow';
  let evaluated = false;
  const existingLock = new AuthPlatformError('AUTH_SECURITY_LOCK', 'already locked');
  // The debt gate runs BEFORE the lock check by design, so the fake must answer it
  // cleanly (no debt) for the pre-existing lock to be the thing that throws.
  const prisma = {
    user: {
      findUnique: async () => ({ balanceCents: 0n, securityLockedAt: null, telegramId: null }),
      findMany: async () => [],
    },
    orderClawback: { findMany: async () => [] },
    session: { findMany: async () => [] },
  };
  const engine = new RiskEngineService(
    prisma as never,
    undefined,
    {
      assertNotLocked: async () => { throw existingLock; },
    } as never,
  );
  const original = engine.evaluateWithdraw.bind(engine);
  engine.evaluateWithdraw = async (...args) => {
    evaluated = true;
    return original(...args);
  };
  try {
    await assert.rejects(
      () => engine.assertWithdrawAllowed({ userId: 1n, amountCents: 100n }),
      (error: unknown) => error === existingLock,
    );
    assert.equal(evaluated, false);
  } finally {
    if (previous === undefined) delete process.env.RISK_ENFORCEMENT_MODE;
    else process.env.RISK_ENFORCEMENT_MODE = previous;
  }
});

test('shadow login re-applies an already-active lock instead of shadowing it', async () => {
  const previous = process.env.RISK_ENFORCEMENT_MODE;
  process.env.RISK_ENFORCEMENT_MODE = 'shadow';
  let applyCalls = 0;
  let eventCalls = 0;
  const engine = new RiskEngineService(
    {
      securityEvent: {
        create: async () => {
          eventCalls += 1;
          return {};
        },
      },
    } as never,
    undefined,
    {
      applyLock: async () => {
        applyCalls += 1;
        return { locked: true };
      },
    } as never,
  );
  try {
    await engine.maybeLockAfterLogin(1n, {
      action: 'BLOCK',
      score: 90,
      factors: ['SECURITY_LOCK_ACTIVE'],
      reason: 'already_locked',
    });
    assert.equal(applyCalls, 1);
    assert.equal(eventCalls, 0);
  } finally {
    if (previous === undefined) delete process.env.RISK_ENFORCEMENT_MODE;
    else process.env.RISK_ENFORCEMENT_MODE = previous;
  }
});
