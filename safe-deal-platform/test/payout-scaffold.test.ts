import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ManualPayoutProvider } from '../src/economy/payouts/manual-payout.provider';
import {
  assessPayoutEligibility, payoutsAutoEnabled,
} from '../src/economy/payouts/payout-policy';

const repoFile = (path: string) => readFileSync(path, 'utf8');

test('payout automation defaults off and MANUAL never claims a transfer', async () => {
  const previous = process.env.PAYOUTS_AUTO_ENABLED;
  delete process.env.PAYOUTS_AUTO_ENABLED;
  try {
    assert.equal(payoutsAutoEnabled(), false);
    const provider = new ManualPayoutProvider();
    assert.equal(provider.externalTransferCapable, false);
    const result = await provider.submit({
      payoutRequestId: 'payout-1',
      attemptKey: 'attempt-1',
      amountCents: 10_000n,
      currency: 'RUB',
      destinationFingerprint: null,
    });
    assert.equal(result.outcome, 'MANUAL_REVIEW');
  } finally {
    if (previous === undefined) delete process.env.PAYOUTS_AUTO_ENABLED;
    else process.env.PAYOUTS_AUTO_ENABLED = previous;
  }
});

test('eligibility routes amount, velocity, account age, risk and flags to review', () => {
  const reasons = assessPayoutEligibility({
    amountCents: 1_000_000n,
    dayTotalCents: 2_000_000n,
    monthTotalCents: 5_000_000n,
    accountCreatedAt: new Date('2026-09-16T00:00:00Z'),
    securityScore: 90,
    withdrawBlocked: true,
    securityLocked: true,
    suspiciousFundsHold: true,
    now: new Date('2026-09-17T00:00:00Z'),
  });
  assert.deepEqual(reasons, [
    'AMOUNT_REVIEW_LIMIT',
    'DAILY_REVIEW_LIMIT',
    'MONTHLY_REVIEW_LIMIT',
    'NEW_ACCOUNT',
    'RISK_SCORE',
    'WITHDRAW_BLOCKED',
    'SECURITY_LOCKED',
    'SUSPICIOUS_FUNDS_HOLD',
  ]);
});

test('withdraw creates one linked request in the debit transaction', () => {
  const ops = repoFile('safe-deal-platform/src/operations.module.ts');
  const schema = repoFile('prisma/schema.prisma');
  assert.match(ops, /createForWithdrawal\(tx,/);
  assert.match(ops, /withdrawalLedgerEntryId:\s*entry\.id/);
  assert.match(schema, /withdrawalLedgerEntryId BigInt\s+@unique/);
  assert.match(schema, /requestKey\s+String\s+@unique/);
  assert.match(schema, /destinationFingerprint\s+String\?/);
});

test('rejection uses one atomic idempotent withdrawal reversal', () => {
  const payouts = repoFile('safe-deal-platform/src/economy/payouts/payout.service.ts');
  assert.match(payouts, /withSerializableTransaction/);
  assert.match(payouts, /payout:\$\{payout\.id\}:reversal/);
  assert.match(payouts, /'WITHDRAWAL_REVERSAL'/);
  assert.match(payouts, /refundLedgerEntryId:\s*refund\.id/);
});

test('processor never auto-marks PAID and alerts on stuck PROCESSING', () => {
  const job = repoFile('safe-deal-platform/src/workers/jobs/payout-processing.job.ts');
  assert.doesNotMatch(job, /status:\s*'PAID'/);
  assert.match(job, /payout-processing-stuck/);
  assert.match(job, /externalTransferCapable/);
  assert.match(job, /attemptKey/);
  assert.match(job, /status:\s*'MANUAL_REVIEW'/);
});
