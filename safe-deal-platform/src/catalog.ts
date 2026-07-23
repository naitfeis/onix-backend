import { ProductCategory, ProductSubcategory } from '@prisma/client';

/** Canonical subcategory catalog (Prisma enum) keyed by ProductCategory. */
export const SUBCATEGORIES_BY_CATEGORY: Record<ProductCategory, ProductSubcategory[]> = {
  STANDOFF_2: ['STANDOFF_GOLD', 'STANDOFF_ACCOUNTS', 'STANDOFF_SKINS', 'STANDOFF_OTHER'],
  STEAM: ['STEAM_TOPUP', 'STEAM_ACCOUNTS', 'STEAM_KEYS', 'STEAM_SKINS', 'STEAM_OTHER'],
  ROBLOX: ['ROBLOX_ROBUX', 'ROBLOX_ACCOUNTS', 'ROBLOX_ITEMS', 'ROBLOX_OTHER'],
  RP_PROJECTS: ['RP_VIRTS', 'RP_ACCOUNTS', 'RP_ITEMS', 'RP_OTHER'],
  BRAWL_STARS: ['BRAWL_DONATE', 'BRAWL_ACCOUNTS', 'BRAWL_BOOST', 'BRAWL_OTHER'],
  CS2: ['CS2_SKINS', 'CS2_ACCOUNTS', 'CS2_BOOST', 'CS2_OTHER'],
  FORTNITE: ['FORTNITE_DONATE', 'FORTNITE_ACCOUNTS', 'FORTNITE_SERVICES', 'FORTNITE_OTHER'],
  VALORANT: ['VALORANT_DONATE', 'VALORANT_ACCOUNTS', 'VALORANT_SERVICES', 'VALORANT_OTHER'],
  GTA_5: ['GTA5_DONATE', 'GTA5_CURRENCY', 'GTA5_ACCOUNTS', 'GTA5_SERVICES', 'GTA5_OTHER'],
  GTA_6: ['GTA6_ACCOUNTS', 'GTA6_KEYS'],
  OTHER: ['OTHER_ACCOUNTS', 'OTHER_ITEMS', 'OTHER_BOOST', 'OTHER_MISC'],
};

export function assertSubcategoryForCategory(
  category: ProductCategory,
  subcategory: ProductSubcategory | null | undefined,
): void {
  if (!subcategory) return;
  const allowed = SUBCATEGORIES_BY_CATEGORY[category];
  if (!allowed.includes(subcategory)) {
    throw new Error(`Подкатегория ${subcategory} недоступна для категории ${category}.`);
  }
}
