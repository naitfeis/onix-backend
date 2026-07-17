/** Platform sale commission — 5% of order total (buyer pays full price; seller gets 95%). */
export const SALE_FEE_BPS = 500n;

/** Subcategories allowed below the global 10 ₽ floor (still ≥ 1 ₽). */
export const NO_MIN_PRICE_SUBCATEGORIES = new Set([
  'STANDOFF_GOLD',
  'ROBLOX_ROBUX',
  'STEAM_TOPUP',
  'RP_VIRTS',
]);

export function minListingPriceCents(subcategory?: string | null): bigint {
  if (subcategory && NO_MIN_PRICE_SUBCATEGORIES.has(subcategory)) return 100n; // 1 ₽
  return 1000n; // 10 ₽
}

export function assertListingPrice(priceCents: bigint, subcategory?: string | null): void {
  const min = minListingPriceCents(subcategory);
  if (priceCents < min) {
    const rub = Number(min) / 100;
    throw new Error(`Минимальная цена: ${rub} ₽`);
  }
}

export function computeSaleAmounts(totalAmountCents: bigint): { feeCents: bigint; payoutCents: bigint } {
  const feeCents = (totalAmountCents * SALE_FEE_BPS) / 10_000n;
  return { feeCents, payoutCents: totalAmountCents - feeCents };
}
