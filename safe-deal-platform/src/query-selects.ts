/**
 * Narrow Prisma selects for list DTOs — same API shape, less I/O.
 * Avoids loading User.balanceCents / Product.deliveryCiphertext on hot paths.
 */

export function sellerPublicSelect(viewerId?: bigint | null) {
  return {
    id: true,
    onixId: true,
    telegramNick: true,
    displayName: true,
    avatarUrl: true,
    ratingAverage: true,
    ratingCount: true,
    completedSales: true,
    lastSeenAt: true,
    isAdmin: true,
    isSupport: true,
    _count: { select: { followers: true as const } },
    // Guest catalog: take 0 (no Follow probe). Authenticated: probe this viewer.
    followers: viewerId != null
      ? {
          where: { followerId: viewerId },
          select: { followerId: true as const },
          take: 1 as const,
        }
      : {
          select: { followerId: true as const },
          take: 0 as const,
        },
  } as const;
}

/** Counterparty on deals — no viewer Follow probe (dealDto never used followed). */
export const dealPartySelect = {
  id: true,
  onixId: true,
  telegramNick: true,
  displayName: true,
  avatarUrl: true,
  ratingAverage: true,
  ratingCount: true,
  completedSales: true,
  lastSeenAt: true,
  isAdmin: true,
  isSupport: true,
  _count: { select: { followers: true as const } },
} as const;

export const productListSelect = {
  id: true,
  title: true,
  description: true,
  priceCents: true,
  quantity: true,
  category: true,
  subcategory: true,
  status: true,
  autoDeliver: true,
  createdAt: true,
} as const;

export const dealProductSelect = {
  id: true,
  title: true,
  category: true,
} as const;
