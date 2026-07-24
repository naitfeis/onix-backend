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
import { RiskEngineService } from '../src/risk/risk-engine.service';
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

test('evaluateLogin: first session ALLOW, no events', async () => {
  const prisma = {
    session: {
      findMany: async () => [],
    },
  };
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
  const prisma = {
    session: {
      findMany: async () => [{
        fingerprintHash: 'old-dev',
        ipAddress: '9.9.9.9',
        country: 'RU',
        timezone: 'Europe/Moscow',
        language: 'ru',
      }],
    },
  };
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
