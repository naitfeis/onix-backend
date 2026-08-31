/** Parse a ruble amount into integer kopecks without IEEE-754 `* 100` rounding. */
export function parseRublesToCents(input: string | number): number {
  const raw = String(input).trim().replace(/\s/g, '').replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return Number.NaN;
  const rubles = Number(match[1]);
  const kopecks = Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(rubles) || rubles > 50_000_000 || !Number.isInteger(kopecks)) {
    return Number.NaN;
  }
  return rubles * 100 + kopecks;
}

export function rublesToCentsString(input: string | number): string {
  const cents = parseRublesToCents(input);
  if (!Number.isSafeInteger(cents)) throw new Error('Некорректная сумма.');
  return String(cents);
}
