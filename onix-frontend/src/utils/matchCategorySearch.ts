import { CATEGORIES, CATEGORY_LABELS } from '../api/contracts';

/** Resolve free-text («Roblox», «кс 2») to a category enum for market search. */
export function matchCategorySearch(raw: string): (typeof CATEGORIES)[number] | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const asEnum = text.toUpperCase().replace(/[\s-]+/g, '_');
  if ((CATEGORIES as readonly string[]).includes(asEnum)) {
    return asEnum as (typeof CATEGORIES)[number];
  }
  const norm = text.toLowerCase().replace(/\s+/g, ' ');
  for (const key of CATEGORIES) {
    if (CATEGORY_LABELS[key].toLowerCase() === norm) return key;
  }
  const aliases: Array<{ re: RegExp; value: (typeof CATEGORIES)[number] }> = [
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
  for (const alias of aliases) {
    if (alias.re.test(text)) return alias.value;
  }
  return undefined;
}
