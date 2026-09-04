export const WARRANTY_DEFAULT_HOURS = 10;
export const WARRANTY_MIN_HOURS = 5;
const WARRANTY_MAX_HOURS = 30 * 24;
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

function clampWarrantyHours(value: unknown, minHours = WARRANTY_MIN_HOURS): number {
  const floor = Math.max(WARRANTY_MIN_HOURS, Math.min(WARRANTY_MAX_HOURS, Math.round(minHours)));
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return Math.max(floor, WARRANTY_DEFAULT_HOURS);
  return Math.min(WARRANTY_MAX_HOURS, Math.max(floor, Math.round(n)));
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

export function formatWarrantyHours(hours: number): string {
  const h = clampWarrantyHours(hours);
  if (h >= WARRANTY_MAX_HOURS) return 'Гарантия: 1 месяц';
  if (h % 24 === 0) {
    const days = h / 24;
    return `Гарантия: ${days} ${dayWord(days)}`;
  }
  return `Гарантия: ${h} ${hourWord(h)}`;
}

export function formatDealCountdown(endsAt: string | null | undefined, nowMs = Date.now()): string | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  const left = Math.max(0, end - nowMs);
  const totalSec = Math.floor(left / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function lotWarrantyBadge(product: { warrantyHours?: number | null; warrantyLabel?: string | null }): string {
  if (product.warrantyLabel?.trim()) return product.warrantyLabel.trim();
  return formatWarrantyHours(product.warrantyHours ?? WARRANTY_DEFAULT_HOURS);
}

export function clampListingWarranty(
  value: unknown,
  accountCreatedAt?: string | null,
): number {
  return clampWarrantyHours(value, warrantyMinHoursForSeller(accountCreatedAt ?? null));
}
