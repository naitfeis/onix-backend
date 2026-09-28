export type LotPayMethod = 'BALANCE' | 'SBP' | 'CARD';

export const LOT_PAY_FEE_BPS: Record<LotPayMethod, number> = {
  BALANCE: 0,
  SBP: 100,
  CARD: 400,
};

export const LOT_PAY_METHODS: LotPayMethod[] = ['BALANCE', 'SBP', 'CARD'];

/**
 * Availability comes from GET /api/payments/methods — see api/paymentMethods.ts.
 * Balance is always live: it never touches a PSP.
 */
export type LotPayAvailability = { sbp: boolean; card: boolean };

export const BALANCE_ONLY_AVAILABILITY: LotPayAvailability = { sbp: false, card: false };

export function isPayMethodLive(
  method: LotPayMethod,
  availability: LotPayAvailability,
): boolean {
  if (method === 'SBP') return availability.sbp === true;
  if (method === 'CARD') return availability.card === true;
  return true;
}

export function lotPayMethodMeta(
  method: LotPayMethod,
  availability: LotPayAvailability = BALANCE_ONLY_AVAILABILITY,
): {
  title: string;
  hint: string;
  icon: 'onix' | 'sbp' | 'card';
  live: boolean;
} {
  const live = isPayMethodLive(method, availability);
  if (method === 'SBP') {
    return { title: 'СБП', hint: live ? 'Сбор 1% с остатка' : 'Скоро', icon: 'sbp', live };
  }
  if (method === 'CARD') {
    return { title: 'Банковская карта', hint: live ? 'Сбор 4% с остатка' : 'Скоро', icon: 'card', live };
  }
  return { title: 'Баланс ONIX', hint: 'Рекомендуемый способ', icon: 'onix', live };
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
  const feeCents = remaining > 0 ? Math.floor((remaining * feeBps) / 10_000) : 0;
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

export function lotPayMethodLabel(
  method: LotPayMethod,
  availability: LotPayAvailability = BALANCE_ONLY_AVAILABILITY,
): string {
  return lotPayMethodMeta(method, availability).title;
}

/** Lot name for checkout. Empty title falls back to the short description. */
export function lotDisplayTitle(product: { title?: string | null; description?: string | null }): string {
  const title = product.title?.trim();
  if (title) return title;
  // Take the first LINE before collapsing whitespace — descriptions often read
  // «1000 рублей по логину стим\nдетали», and the checkout header must show
  // only the price line, not the whole blurb.
  const plain = (product.description ?? '').replace(/<[^>]+>/g, ' ');
  const firstLine = plain
    .split(/\r?\n/)
    .map((row) => row.replace(/\s+/g, ' ').trim())
    .find((row) => row.length > 0);
  if (firstLine) return firstLine.slice(0, 80);
  const collapsed = plain.replace(/\s+/g, ' ').trim();
  return collapsed ? collapsed.slice(0, 80) : 'Лот';
}

/** Short blurb under the title — never an empty field. */
export function lotShortDescription(product: { title?: string | null; description?: string | null }): string {
  const title = product.title?.trim();
  if (title) return title;
  return lotDisplayTitle(product);
}
