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
  DOTA_2: ['DOTA_ACCOUNTS', 'DOTA_ITEMS', 'DOTA_BOOST', 'DOTA_OTHER'],
  PUBG_MOBILE: ['PUBG_DONATE', 'PUBG_ACCOUNTS', 'PUBG_SERVICES', 'PUBG_OTHER'],
  GENSHIN: ['GENSHIN_DONATE', 'GENSHIN_ACCOUNTS', 'GENSHIN_SERVICES', 'GENSHIN_OTHER'],
  MOBILE_LEGENDS: ['ML_DONATE', 'ML_ACCOUNTS', 'ML_SERVICES', 'ML_OTHER'],
  APP_STORE: ['APPSTORE_TOPUP', 'APPSTORE_GIFTCARDS', 'APPSTORE_ACCOUNTS', 'APPSTORE_OTHER'],
  PUBG: ['PUBG_DONATE', 'PUBG_ACCOUNTS', 'PUBG_SERVICES', 'PUBG_OTHER'],
  MINECRAFT: ['MC_ACCOUNTS', 'MC_ITEMS', 'MC_SERVICES', 'MC_OTHER'],
  PLAYSTATION: ['PS_ACCOUNTS', 'PS_GAMES', 'PS_TOPUP', 'PS_OTHER'],
  STALCRAFT: ['STALCRAFT_ACCOUNTS', 'STALCRAFT_ITEMS', 'STALCRAFT_SERVICES', 'STALCRAFT_OTHER'],
  PATH_OF_EXILE_2: ['POE2_ACCOUNTS', 'POE2_CURRENCY', 'POE2_ITEMS', 'POE2_OTHER'],
  OTHER: ['OTHER_ACCOUNTS', 'OTHER_ITEMS', 'OTHER_BOOST', 'OTHER_MISC'],
};

export const PRODUCT_CATEGORIES = Object.keys(SUBCATEGORIES_BY_CATEGORY) as ProductCategory[];

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  STEAM: 'Steam',
  ROBLOX: 'Roblox',
  RP_PROJECTS: 'RP проекты',
  STANDOFF_2: 'Standoff 2',
  BRAWL_STARS: 'Brawl Stars',
  CS2: 'Counter-Strike 2',
  FORTNITE: 'Fortnite',
  VALORANT: 'Valorant',
  GTA_5: 'GTA 5',
  GTA_6: 'GTA 6',
  DOTA_2: 'Dota 2',
  PUBG_MOBILE: 'PUBG Mobile',
  GENSHIN: 'Genshin Impact',
  MOBILE_LEGENDS: 'Mobile Legends',
  APP_STORE: 'App Store',
  PUBG: 'PUBG',
  MINECRAFT: 'Minecraft',
  PLAYSTATION: 'PlayStation',
  STALCRAFT: 'Stalcraft',
  PATH_OF_EXILE_2: 'Path of Exile 2',
  OTHER: 'Другое',
};

const CATEGORY_ALIASES: Array<{ re: RegExp; value: ProductCategory }> = [
  { re: /^(standoff\s*2|стандофф)$/i, value: 'STANDOFF_2' },
  { re: /^(steam|стим)$/i, value: 'STEAM' },
  { re: /^(roblox|роблокс)$/i, value: 'ROBLOX' },
  { re: /^(rp\s*проекты|рп\s*проекты|rp)$/i, value: 'RP_PROJECTS' },
  { re: /^(brawl\s*stars|бравл)$/i, value: 'BRAWL_STARS' },
  { re: /^(counter[-\s]?strike\s*2|cs\s*2|кс\s*2)$/i, value: 'CS2' },
  { re: /^(fortnite|фортнайт)$/i, value: 'FORTNITE' },
  { re: /^(valorant|валорант)$/i, value: 'VALORANT' },
  { re: /^(gta\s*5|гта\s*5|gta\s*v)$/i, value: 'GTA_5' },
  { re: /^(gta\s*6|гта\s*6|gta\s*vi)$/i, value: 'GTA_6' },
  { re: /^(dota\s*2|дота\s*2|дота)$/i, value: 'DOTA_2' },
  { re: /^(pubg\s*mobile|пубг\s*мобайл)$/i, value: 'PUBG_MOBILE' },
  { re: /^(pubg|пубг)$/i, value: 'PUBG' },
  { re: /^(genshin(\s*impact)?|геншин)$/i, value: 'GENSHIN' },
  { re: /^(mobile\s*legends|млбб)$/i, value: 'MOBILE_LEGENDS' },
  { re: /^(app\s*store|апп\s*стор)$/i, value: 'APP_STORE' },
  { re: /^(minecraft|майнкрафт|майн)$/i, value: 'MINECRAFT' },
  { re: /^(playstation|плейстейшн|ps\s*[45])$/i, value: 'PLAYSTATION' },
  { re: /^(stalcraft|сталкрафт)$/i, value: 'STALCRAFT' },
  { re: /^(path\s*of\s*exile\s*2|poe\s*2|поэ\s*2)$/i, value: 'PATH_OF_EXILE_2' },
  { re: /^(другое|other)$/i, value: 'OTHER' },
];

/** Map free-text search («Roblox», «кс 2») to a ProductCategory enum. */
export function matchProductCategory(raw: string): ProductCategory | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const asEnum = text.toUpperCase().replace(/[\s-]+/g, '_');
  if ((asEnum as ProductCategory) in SUBCATEGORIES_BY_CATEGORY) {
    return asEnum as ProductCategory;
  }
  const norm = text.toLowerCase().replace(/\s+/g, ' ');
  for (const [key, label] of Object.entries(CATEGORY_LABELS) as Array<[ProductCategory, string]>) {
    if (label.toLowerCase() === norm) return key;
  }
  for (const alias of CATEGORY_ALIASES) {
    if (alias.re.test(text)) return alias.value;
  }
  return undefined;
}

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
