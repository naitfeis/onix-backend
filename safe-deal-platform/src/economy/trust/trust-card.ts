/**
 * Public trust card — NEVER includes trustScore.
 * Flat aliases (level / depositTotal / *Verified) match buyer-facing contract.
 */
export type PublicTrustCard = {
  trustLevel: number;
  /** Alias of trustLevel */
  level: number;
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

export function buildPublicTrustCard(input: {
  trustLevel: number;
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
