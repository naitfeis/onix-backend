export const WARRANTY_DEFAULT_HOURS = 10;
export const WARRANTY_MIN_HOURS = 5;
export const WARRANTY_MAX_HOURS = 30 * 24;

export function clampWarrantyHours(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return WARRANTY_DEFAULT_HOURS;
  return Math.min(WARRANTY_MAX_HOURS, Math.max(WARRANTY_MIN_HOURS, Math.round(n)));
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
