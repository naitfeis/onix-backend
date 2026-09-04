export const WARRANTY_DEFAULT_HOURS = 10;
export const WARRANTY_MIN_HOURS = 5;
export const WARRANTY_MAX_HOURS = 30 * 24;
/** First week after signup — listing warranty cannot be shorter than 24h. */
export const NEW_SELLER_DAYS = 7;
export const NEW_SELLER_WARRANTY_MIN_HOURS = 24;

export function isNewSellerAccount(accountCreatedAt: Date | string, now = new Date()): boolean {
  const created = accountCreatedAt instanceof Date ? accountCreatedAt : new Date(accountCreatedAt);
  if (!Number.isFinite(created.getTime())) return false;
  return now.getTime() < created.getTime() + NEW_SELLER_DAYS * 86_400_000;
}

export function warrantyMinHoursForSeller(accountCreatedAt?: Date | string | null, now = new Date()): number {
  if (!accountCreatedAt) return NEW_SELLER_WARRANTY_MIN_HOURS;
  if (isNewSellerAccount(accountCreatedAt, now)) return NEW_SELLER_WARRANTY_MIN_HOURS;
  return WARRANTY_MIN_HOURS;
}

export function clampWarrantyHours(value: unknown, minHours = WARRANTY_MIN_HOURS): number {
  const floor = Math.max(WARRANTY_MIN_HOURS, Math.min(WARRANTY_MAX_HOURS, Math.round(minHours)));
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return Math.max(floor, WARRANTY_DEFAULT_HOURS);
  }
  return Math.min(WARRANTY_MAX_HOURS, Math.max(floor, Math.round(n)));
}

export function clampWarrantyHoursForSeller(
  value: unknown,
  accountCreatedAt?: Date | string | null,
  now = new Date(),
): number {
  return clampWarrantyHours(value, warrantyMinHoursForSeller(accountCreatedAt, now));
}

export function formatWarranty(hours: number): string {
  const h = clampWarrantyHours(hours);
  if (h >= WARRANTY_MAX_HOURS) return 'Гарантия: 1 месяц';
  if (h % 24 === 0) {
    const days = h / 24;
    return `Гарантия: ${days} ${dayWord(days)}`;
  }
  return `Гарантия: ${h} ${hourWord(h)}`;
}

function dayWord(n: number): string {
  const abs = n % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
}

function hourWord(n: number): string {
  const abs = n % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'часов';
  if (last === 1) return 'час';
  if (last >= 2 && last <= 4) return 'часа';
  return 'часов';
}
