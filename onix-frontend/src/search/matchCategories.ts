import { CATEGORIES, CATEGORY_LABELS } from '../api/contracts';
import { CATEGORY_ALIASES } from './categoryAliases';

export type CategoryMatch = {
  category: string;
  label: string;
  /** 0 exact, 1 label prefix, 2 alias prefix, 3 word prefix, 4 substring. */
  rank: number;
};

const EN_TO_RU: Record<string, string> = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ',
  a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э',
  z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю', '`': 'ё',
};

const RU_TO_EN: Record<string, string> = Object.fromEntries(
  Object.entries(EN_TO_RU).map(([en, ru]) => [ru, en]),
);

/** Lowercase, ё→е, collapse spaces/hyphens/dots. */
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapAlphabet(value: string, table: Record<string, string>): string {
  return [...value].map((char) => table[char] ?? char).join('');
}

function isSingleAlphabet(value: string): boolean {
  const en = /[a-z]/;
  const ru = /[а-я]/;
  const hasEn = en.test(value);
  const hasRu = ru.test(value);
  return !hasEn || !hasRu;
}

/** Original + EN→RU + RU→EN (mixed alphabets are not converted). */
export function keyboardLayoutCandidates(raw: string): string[] {
  const value = raw.trim();
  if (!value || !isSingleAlphabet(value)) return value ? [value] : [];
  const candidates = new Set<string>([value]);
  candidates.add(mapAlphabet(value, EN_TO_RU));
  candidates.add(mapAlphabet(value, RU_TO_EN));
  return [...candidates];
}

function aliasesFor(category: string): string[] {
  return (CATEGORY_ALIASES[category] ?? []).map(normalizeSearchText);
}

function rankMatch(query: string, category: string): number | null {
  const label = normalizeSearchText(CATEGORY_LABELS[category] ?? category);
  const aliases = aliasesFor(category);
  const words = label.split(' ');
  const single = query.length === 1;
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (aliases.some((alias) => alias.startsWith(query))) return 2;
  if (!single) {
    if (words.some((word) => word.startsWith(query))) return 3;
    if (query.length > 2 && label.includes(query)) return 4;
  }
  return null;
}

/** Ranked category matches for a raw query (layout-aware, deduped). */
export function matchCategories(
  raw: string,
  counts: Record<string, number> = {},
  limit = 6,
): CategoryMatch[] {
  const candidates = keyboardLayoutCandidates(raw).map(normalizeSearchText);
  if (candidates.length === 0 || candidates.includes('')) return [];
  const seen = new Map<string, number>();
  for (const category of CATEGORIES) {
    let best: number | null = null;
    for (const query of candidates) {
      const rank = rankMatch(query, category);
      if (rank !== null && (best === null || rank < best)) best = rank;
    }
    if (best !== null) seen.set(category, best);
  }
  return [...seen.entries()]
    .sort((a, b) => {
      const [catA, rankA] = a;
      const [catB, rankB] = b;
      if (rankA !== rankB) return rankA - rankB;
      const countA = counts[catA] ?? 0;
      const countB = counts[catB] ?? 0;
      if (countA !== countB) return countB - countA;
      return (CATEGORY_LABELS[catA] ?? catA).localeCompare(CATEGORY_LABELS[catB] ?? catB, 'ru');
    })
    .slice(0, limit)
    .map(([category, rank]) => ({ category, rank, label: CATEGORY_LABELS[category] ?? category }));
}

/** Split label into [before, matched, after] for the first match. */
export function highlightParts(label: string, raw: string): [string, string, string] | null {
  const candidates = keyboardLayoutCandidates(raw);
  const normalizedLabel = normalizeSearchText(label);
  for (const candidate of candidates) {
    const query = normalizeSearchText(candidate);
    if (!query) continue;
    const index = normalizedLabel.indexOf(query);
    if (index >= 0) return [label.slice(0, index), label.slice(index, index + query.length), label.slice(index + query.length)];
  }
  return null;
}

/** Subcategories whose normalized label starts with/contains the query. */
export function matchSubcategories(subcategories: readonly string[], labels: Record<string, string>, raw: string): string[] {
  const candidates = keyboardLayoutCandidates(raw).map(normalizeSearchText).filter(Boolean);
  if (candidates.length === 0) return [];
  const matched = new Set<string>();
  for (const sub of subcategories) {
    const label = normalizeSearchText(labels[sub] ?? sub);
    for (const query of candidates) {
      if (label.startsWith(query) || label.includes(query)) matched.add(sub);
    }
  }
  return subcategories.filter((sub) => matched.has(sub));
}
