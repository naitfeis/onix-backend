/** Reviews are allowed only on completed paid deals of at least 100 ₽. */
export const MIN_REVIEW_AMOUNT_CENTS = 10_000n;

export type ReviewHideReason = 'REFUND' | 'APPEAL';

export function canLeaveReview(input: {
  status: string;
  buyerId: bigint;
  authorId: bigint;
  totalAmountCents: bigint;
}): boolean {
  return input.status === 'COMPLETED'
    && input.buyerId === input.authorId
    && input.totalAmountCents >= MIN_REVIEW_AMOUNT_CENTS;
}

/**
 * Bayesian average so one 5★ deal cannot dominate the public rating.
 * priorStrength (m) and priorMean (C) are tunable.
 */
export function bayesianRating(
  average: number,
  count: number,
  priorMean = 4.2,
  priorStrength = 5,
): number {
  if (count <= 0 || !Number.isFinite(average)) return 0;
  const m = Math.max(1, priorStrength);
  const score = (count / (count + m)) * average + (m / (count + m)) * priorMean;
  return Math.round(Math.min(5, Math.max(0, score)) * 100) / 100;
}

export function reviewCountLabel(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return `${n} отзывов`;
  if (last === 1) return `${n} отзыв`;
  if (last >= 2 && last <= 4) return `${n} отзыва`;
  return `${n} отзывов`;
}
