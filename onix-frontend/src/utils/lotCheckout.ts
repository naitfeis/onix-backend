export type LotPayMethod = 'BALANCE' | 'SBP' | 'CARD';

export const LOT_PAY_FEE_BPS: Record<LotPayMethod, number> = {
  BALANCE: 0,
  SBP: 100,
  CARD: 400,
};

export const LOT_PAY_METHODS: LotPayMethod[] = ['BALANCE', 'SBP', 'CARD'];

export function lotPayMethodMeta(method: LotPayMethod): {
  title: string;
  hint: string;
  icon: 'onix' | 'sbp' | 'card';
  live: boolean;
} {
  if (method === 'SBP') return { title: 'СБП', hint: 'Сбор 1% с остатка', icon: 'sbp', live: true };
  if (method === 'CARD') return { title: 'Банковская карта', hint: 'Сбор 4% с остатка', icon: 'card', live: true };
  return { title: 'Баланс ONIX', hint: 'Рекомендуемый способ', icon: 'onix', live: true };
}

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
  return lotPayMethodMeta(method).title;
}

/** Lot name for checkout. Empty title falls back to the short description. */
export function lotDisplayTitle(product: { title?: string | null; description?: string | null }): string {
  const title = product.title?.trim();
  if (title) return title;
  const line = product.description?.trim().split(/\n/)[0]?.trim();
  if (line) return line.slice(0, 80);
  return 'Лот';
}

/** Short blurb under the title — never an empty field. */
export function lotShortDescription(product: { title?: string | null; description?: string | null }): string {
  const title = product.title?.trim();
  if (title) return title;
  return lotDisplayTitle(product);
}
