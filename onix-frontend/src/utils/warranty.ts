export const WARRANTY_DEFAULT_HOURS = 10;
const WARRANTY_MAX_HOURS = 30 * 24;

function clampWarrantyHours(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return WARRANTY_DEFAULT_HOURS;
  return Math.min(WARRANTY_MAX_HOURS, Math.max(5, Math.round(n)));
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

export function lotWarrantyBadge(product: { warrantyHours?: number | null; warrantyLabel?: string | null }): string {
  const label = product.warrantyLabel?.trim();
  if (label) return label;
  return formatWarrantyHours(product.warrantyHours ?? WARRANTY_DEFAULT_HOURS);
}
