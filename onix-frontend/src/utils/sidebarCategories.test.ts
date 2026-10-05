import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../api/contracts';
import { rememberSidebarRecentCategory, orderSidebarCategories } from './sidebarCategories';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

describe('orderSidebarCategories', () => {
  it('places recent categories first, newest on top, without duplicates', () => {
    const ordered = orderSidebarCategories(CATEGORIES, ['STEAM', 'CS2']);
    expect(ordered.slice(0, 2)).toEqual(['STEAM', 'CS2']);
    expect(new Set(ordered).size).toBe(ordered.length);
    expect(ordered.slice(2)).toEqual(CATEGORIES.filter((cat) => cat !== 'STEAM' && cat !== 'CS2'));
  });

  it('keeps the base list when there are no recent categories', () => {
    expect(orderSidebarCategories(CATEGORIES, [])).toEqual([...CATEGORIES]);
  });

  it('ignores unknown categories', () => {
    const ordered = orderSidebarCategories(CATEGORIES, ['NOT_A_CATEGORY']);
    expect(ordered).toEqual([...CATEGORIES]);
  });
});

describe('rememberSidebarRecentCategory', () => {
  it('moves a category to the top and keeps the storage limit', () => {
    const storage = memoryStorage();
    for (const category of ['STEAM', 'ROBLOX', 'CS2', 'GTA_5', 'OTHER']) {
      rememberSidebarRecentCategory(category, storage);
    }
    expect(rememberSidebarRecentCategory('GTA_6', storage)).toEqual(['GTA_6', 'OTHER', 'GTA_5', 'CS2', 'ROBLOX']);
  });

  it('uses the caller-provided limit when present', () => {
    const storage = memoryStorage();
    for (const category of ['STEAM', 'ROBLOX', 'CS2', 'GTA_5', 'OTHER', 'PUBG', 'MINECRAFT']) {
      rememberSidebarRecentCategory(category, storage, 8);
    }
    expect(rememberSidebarRecentCategory('PLAYSTATION', storage, 8)).toHaveLength(8);
  });
});
