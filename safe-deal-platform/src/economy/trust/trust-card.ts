/**
 * Public trust card — NEVER includes trustScore.
 * Flat aliases (level / depositTotal / *Verified) match buyer-facing contract.
 * `progress` is score/10 clamped 0–100 for the profile meter only.
 */
export type PublicTrustCard = {
  trustLevel: number;
  /** Alias of trustLevel */
  level: number;
  /** 0–100 meter fill derived from internal score (score never exposed). */
  progress: number;
  depositTotalCents: string;
  /** Alias of depositTotalCents (kopecks string, same as balanceCents) */
  depositTotal: string;
  registeredAt: string;
  reviewCount: number;
  salesCount: number;
  rating: number;
  /** Commercial badge — not part of trust formula. */
  proActive: boolean;
};

function progressFromScore(score: number | null | undefined, level: number): number {
  if (typeof score === 'number' && Number.isFinite(score)) {
    return Math.max(0, Math.min(100, Math.round(score / 10)));
  }
  // Fallback when score is unavailable: mid-band estimate by level (1–5).
  const clamped = Math.max(1, Math.min(5, Math.round(level) || 1));
  return Math.max(0, Math.min(100, Math.round(((clamped - 1) / 4) * 100)));
}

export function buildPublicTrustCard(input: {
  trustLevel: number;
  /** Internal 0–1000 — used only to derive public progress, never returned. */
  trustScore?: number | null;
  depositAvailableCents: bigint;
  depositLockedCents: bigint;
  createdAt: Date;
  ratingAverage: { toString(): string } | number;
  ratingCount: number;
  completedSales: number;
  proActive: boolean;
}): PublicTrustCard {
  const depositTotalCents = (input.depositAvailableCents + input.depositLockedCents).toString();
  const card: PublicTrustCard = {
    trustLevel: input.trustLevel,
    level: input.trustLevel,
    progress: progressFromScore(input.trustScore, input.trustLevel),
    depositTotalCents,
    depositTotal: depositTotalCents,
    registeredAt: input.createdAt.toISOString(),
    reviewCount: input.ratingCount,
    salesCount: input.completedSales,
    rating: Number(input.ratingAverage),
    proActive: input.proActive,
  };
  // Hard guarantee: never attach internal score.
  if ('trustScore' in (card as object)) {
    delete (card as { trustScore?: unknown }).trustScore;
  }
  return card;
}

/** Runtime guard for public responses. */
export function assertNoTrustScore(payload: unknown): void {
  if (payload && typeof payload === 'object' && 'trustScore' in payload) {
    throw new Error('Public trust payload must not include trustScore');
  }
}
