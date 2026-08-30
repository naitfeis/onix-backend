export type LotPayMethod = 'BALANCE' | 'SBP' | 'CARD';

export const LOT_PAY_FEE_BPS: Record<LotPayMethod, number> = {
  BALANCE: 0,
  SBP: 100,
  CARD: 400,
};

export function parseCents(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** Apply balance first; leftover is paid externally with a percent fee. */
export function quoteLotCheckout(priceCents: number, balanceCents: number, method: LotPayMethod) {
  const price = Math.max(0, Math.round(priceCents));
  const balance = Math.max(0, Math.round(balanceCents));
  const fromBalance = Math.min(balance, price);
  const remaining = price - fromBalance;
  const feeBps = remaining > 0 ? LOT_PAY_FEE_BPS[method] : 0;
  const feeCents = Math.round((remaining * feeBps) / 10_000);
  const externalCents = remaining + feeCents;
  return {
    priceCents: price,
    balanceCents: balance,
    fromBalanceCents: fromBalance,
    remainingCents: remaining,
    feeBps,
    feeCents,
    externalCents,
    coveredByBalance: remaining === 0,
  };
}

export function lotPayMethodLabel(method: LotPayMethod): string {
  if (method === 'SBP') return 'СБП';
  if (method === 'CARD') return 'Банковская карта';
  return 'Баланс ONIX';
}
