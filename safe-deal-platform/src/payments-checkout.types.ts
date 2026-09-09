export type PaymentCheckoutMetadata = {
  checkout: {
    productId: string;
    quantity: number;
    purchaseIdempotencyKey: string;
  };
};

export function parsePaymentCheckoutMetadata(metadata: unknown): PaymentCheckoutMetadata['checkout'] | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const checkout = (metadata as { checkout?: unknown }).checkout;
  if (!checkout || typeof checkout !== 'object') return null;
  const row = checkout as {
    productId?: unknown;
    quantity?: unknown;
    purchaseIdempotencyKey?: unknown;
  };
  if (typeof row.productId !== 'string' || !row.productId.trim()) return null;
  if (typeof row.purchaseIdempotencyKey !== 'string' || row.purchaseIdempotencyKey.length < 16) return null;
  const quantity = typeof row.quantity === 'number' ? row.quantity : Number(row.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) return null;
  return {
    productId: row.productId.trim(),
    quantity,
    purchaseIdempotencyKey: row.purchaseIdempotencyKey,
  };
}
