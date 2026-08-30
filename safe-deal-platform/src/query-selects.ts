/**
 * Narrow Prisma selects for list DTOs — same API shape, less I/O.
 * Avoids loading User.balanceCents / Product.deliveryCiphertext on hot paths.
 */

/** Full seller card (product detail, deals, profiles). */
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
    platformStatus: true,
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

/**
 * Hot GET /api/products catalog — minimal seller fields for cards.
 * No followers COUNT, no Follow probe, no telegramNick.
 */
export const sellerCatalogSelect = {
  id: true,
  onixId: true,
  displayName: true,
  avatarUrl: true,
  ratingAverage: true,
  ratingCount: true,
  completedSales: true,
  lastSeenAt: true,
  isAdmin: true,
  isSupport: true,
  platformStatus: true,
} as const;

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
  platformStatus: true,
  _count: { select: { followers: true as const } },
} as const;

/** Hot catalog path — no description / view counts (owner views on detail / my listings). */
export const productListSelect = {
  id: true,
  lotNumber: true,
  title: true,
  priceCents: true,
  quantity: true,
  category: true,
  subcategory: true,
  status: true,
  autoDeliver: true,
  createdAt: true,
  sellerId: true,
  warrantyHours: true,
} as const;

/** Single product / owner edit — includes description. */
export const productDetailSelect = {
  ...productListSelect,
  description: true,
  shadowBannedAt: true,
} as const;

export const dealProductSelect = {
  id: true,
  title: true,
  category: true,
  subcategory: true,
  autoDeliver: true,
} as const;
