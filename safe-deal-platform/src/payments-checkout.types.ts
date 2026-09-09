export type PaymentCheckoutBind = {
  productId: string;
  quantity: number;
  purchaseIdempotencyKey: string;
};

export type PaymentCheckoutMetadata = {
  checkout: PaymentCheckoutBind & {
    /** Frozen unit price at reservation time (cents string). */
    unitPriceCents: string;
    /** Frozen order total at reservation time (cents string). */
    totalAmountCents: string;
    /** Stock already decremented for this intent. */
    stockReserved: boolean;
    /** Acquiring fee cents included in PaymentIntent.amountCents. */
    externalFeeCents: string;
  };
};

export function checkoutAcquiringFeeBps(provider: string): number {
  if (provider === 'CARD') return 400;
  if (provider === 'YOOKASSA') return 100;
  return 0;
}

export function computeCheckoutExternalCents(
  totalAmountCents: bigint,
  spendableBalanceCents: bigint,
  feeBps: number,
): { remainingCents: bigint; feeCents: bigint; externalCents: bigint } {
  const remaining = totalAmountCents > spendableBalanceCents
    ? totalAmountCents - spendableBalanceCents
    : 0n;
  const feeCents = remaining > 0n && feeBps > 0
    ? (remaining * BigInt(feeBps)) / 10_000n
    : 0n;
  return {
    remainingCents: remaining,
    feeCents,
    externalCents: remaining + feeCents,
  };
}

export function parsePaymentCheckoutMetadata(metadata: unknown): PaymentCheckoutMetadata['checkout'] | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const checkout = (metadata as { checkout?: unknown }).checkout;
  if (!checkout || typeof checkout !== 'object') return null;
  const row = checkout as Record<string, unknown>;
  if (typeof row.productId !== 'string' || !row.productId.trim()) return null;
  if (typeof row.purchaseIdempotencyKey !== 'string' || row.purchaseIdempotencyKey.length < 16) return null;
  const quantity = typeof row.quantity === 'number' ? row.quantity : Number(row.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) return null;
  const unitPriceCents = typeof row.unitPriceCents === 'string' ? row.unitPriceCents : null;
  const totalAmountCents = typeof row.totalAmountCents === 'string' ? row.totalAmountCents : null;
  const externalFeeCents = typeof row.externalFeeCents === 'string' ? row.externalFeeCents : '0';
  if (!unitPriceCents || !/^\d+$/.test(unitPriceCents)) return null;
  if (!totalAmountCents || !/^\d+$/.test(totalAmountCents)) return null;
  if (!/^\d+$/.test(externalFeeCents)) return null;
  return {
    productId: row.productId.trim(),
    quantity,
    purchaseIdempotencyKey: row.purchaseIdempotencyKey,
    unitPriceCents,
    totalAmountCents,
    stockReserved: row.stockReserved === true,
    externalFeeCents,
  };
}

export function checkoutBindFingerprint(checkout: PaymentCheckoutBind | PaymentCheckoutMetadata['checkout'] | null): string {
  if (!checkout) return 'null';
  return JSON.stringify({
    productId: checkout.productId,
    quantity: checkout.quantity,
    purchaseIdempotencyKey: checkout.purchaseIdempotencyKey,
  });
}
