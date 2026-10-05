export const SIDEBAR_RECENT_CATEGORIES_KEY = 'onix-recent-categories';
export const SIDEBAR_RECENT_CATEGORIES_LIMIT = 5;

export function orderSidebarCategories(categories: readonly string[], recent: readonly string[]): string[] {
  const known = new Set(categories);
  const recentSet = new Set<string>();
  const ordered: string[] = [];
  for (const category of recent) {
    if (!known.has(category) || recentSet.has(category)) continue;
    recentSet.add(category);
    ordered.push(category);
  }
  for (const category of categories) {
    if (!recentSet.has(category)) ordered.push(category);
  }
  return ordered;
}

export function readSidebarRecentCategories(
  storage: Pick<Storage, 'getItem'>,
  limit: number = SIDEBAR_RECENT_CATEGORIES_LIMIT,
): string[] {
  try {
    const parsed = JSON.parse(storage.getItem(SIDEBAR_RECENT_CATEGORIES_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function rememberSidebarRecentCategory(
  category: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  limit: number = SIDEBAR_RECENT_CATEGORIES_LIMIT,
): string[] {
  const previous = readSidebarRecentCategories(storage, limit);
  const next = [category, ...previous.filter((item) => item !== category)].slice(0, limit);
  try {
    storage.setItem(SIDEBAR_RECENT_CATEGORIES_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota: in-memory order still updates */
  }
  return next;
}
