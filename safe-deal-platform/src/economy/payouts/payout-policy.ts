export type PayoutEligibilityInput = {
  amountCents: bigint;
  dayTotalCents: bigint;
  monthTotalCents: bigint;
  accountCreatedAt: Date;
  securityScore: number;
  withdrawBlocked: boolean;
  securityLocked: boolean;
  suspiciousFundsHold: boolean;
  now?: Date;
};

function positiveBigIntEnv(name: string, fallback: bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw || !/^[1-9]\d*$/.test(raw)) return fallback;
  return BigInt(raw);
}

function nonNegativeIntEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function payoutsAutoEnabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PAYOUTS_AUTO_ENABLED?.trim() ?? '');
}

/**
 * Decides review routing only. It never replaces the existing MFA, clawback,
 * spendable-balance, velocity, or security-lock guards.
 */
export function assessPayoutEligibility(input: PayoutEligibilityInput): string[] {
  const reasons: string[] = [];
  const amountReviewCents = positiveBigIntEnv('PAYOUT_REVIEW_AMOUNT_CENTS', 1_000_000n);
  const dayReviewCents = positiveBigIntEnv('PAYOUT_REVIEW_DAY_CENTS', 2_000_000n);
  const monthReviewCents = positiveBigIntEnv('PAYOUT_REVIEW_MONTH_CENTS', 5_000_000n);
  const minAccountAgeDays = nonNegativeIntEnv('PAYOUT_MIN_ACCOUNT_AGE_DAYS', 7);
  const maxAutoRiskScore = nonNegativeIntEnv('PAYOUT_MAX_AUTO_RISK_SCORE', 69);
  const now = input.now ?? new Date();
  const accountAgeDays = Math.floor(
    (now.getTime() - input.accountCreatedAt.getTime()) / 86_400_000,
  );

  if (input.amountCents >= amountReviewCents) reasons.push('AMOUNT_REVIEW_LIMIT');
  if (input.dayTotalCents + input.amountCents > dayReviewCents) reasons.push('DAILY_REVIEW_LIMIT');
  if (input.monthTotalCents + input.amountCents > monthReviewCents) reasons.push('MONTHLY_REVIEW_LIMIT');
  if (accountAgeDays < minAccountAgeDays) reasons.push('NEW_ACCOUNT');
  if (input.securityScore > maxAutoRiskScore) reasons.push('RISK_SCORE');
  if (input.withdrawBlocked) reasons.push('WITHDRAW_BLOCKED');
  if (input.securityLocked) reasons.push('SECURITY_LOCKED');
  if (input.suspiciousFundsHold) reasons.push('SUSPICIOUS_FUNDS_HOLD');
  return reasons;
}
