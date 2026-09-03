import { CATEGORIES, CATEGORY_LABELS } from '../api/contracts';

type Cat = (typeof CATEGORIES)[number];

const ALIASES: Array<{ re: RegExp; value: Cat }> = [
  { re: /standoff\s*2|стандофф/i, value: 'STANDOFF_2' },
  { re: /\bsteam\b|стим/i, value: 'STEAM' },
  { re: /\broblox\b|роблокс/i, value: 'ROBLOX' },
  { re: /rp\s*проекты|рп\s*проекты|\brp\b/i, value: 'RP_PROJECTS' },
  { re: /brawl\s*stars|бравл/i, value: 'BRAWL_STARS' },
  { re: /counter[-\s]?strike\s*2|\bcs\s*2\b|кс\s*2/i, value: 'CS2' },
  { re: /\bfortnite\b|фортнайт/i, value: 'FORTNITE' },
  { re: /gta\s*5|гта\s*5|gta\s*v/i, value: 'GTA_5' },
  { re: /gta\s*6|гта\s*6|gta\s*vi/i, value: 'GTA_6' },
  { re: /dota\s*2|дота\s*2|\bдота\b/i, value: 'DOTA_2' },
  { re: /pubg\s*mobile|пубг\s*мобайл/i, value: 'PUBG_MOBILE' },
  { re: /\bpubg\b|пубг/i, value: 'PUBG' },
  { re: /genshin(\s*impact)?|геншин/i, value: 'GENSHIN' },
  { re: /mobile\s*legends|млбб/i, value: 'MOBILE_LEGENDS' },
  { re: /app\s*store|апп\s*стор/i, value: 'APP_STORE' },
  { re: /\bminecraft\b|майнкрафт|\bмайн\b/i, value: 'MINECRAFT' },
  { re: /\bplaystation\b|плейстейшн|ps\s*[45]/i, value: 'PLAYSTATION' },
  { re: /\bstalzone\b|\bstalcraft\b|сталзон|сталкрафт/i, value: 'STALCRAFT' },
  { re: /path\s*of\s*exile\s*2|\bpoe\s*2\b|поэ\s*2/i, value: 'PATH_OF_EXILE_2' },
  { re: /\bдругое\b|\bother\b/i, value: 'OTHER' },
];

/** Resolve free-text («Roblox», «кс 2», «steam аккаунт») to a category enum. */
export function matchCategorySearch(raw: string): Cat | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const asEnum = text.toUpperCase().replace(/[\s-]+/g, '_');
  if ((CATEGORIES as readonly string[]).includes(asEnum)) {
    return asEnum as Cat;
  }
  const norm = text.toLowerCase().replace(/\s+/g, ' ');
  for (const key of CATEGORIES) {
    const label = CATEGORY_LABELS[key].toLowerCase();
    const keyWords = key.toLowerCase().replace(/_/g, ' ');
    if (
      label === norm
      || norm === keyWords
      || norm.startsWith(`${label} `)
      || norm.startsWith(`${keyWords} `)
      || norm.includes(` ${label}`)
      || norm.includes(` ${keyWords}`)
    ) {
      return key;
    }
  }
  for (const alias of ALIASES) {
    if (alias.re.test(text)) return alias.value;
  }
  return undefined;
}
