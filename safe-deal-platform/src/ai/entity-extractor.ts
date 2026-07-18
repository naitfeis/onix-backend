import { ProductCategory, ProductSubcategory } from '@prisma/client';
import { SUBCATEGORIES_BY_CATEGORY } from '../catalog';

export type ExtractedProductFields = {
  title?: string;
  category?: ProductCategory;
  subcategory?: ProductSubcategory;
  priceRubles?: number;
  quantity?: number;
  description?: string;
  descriptionSkipped?: boolean;
};

const CATEGORY_ALIASES: Array<{ re: RegExp; value: ProductCategory }> = [
  { re: /\b(standoff\s*2|стандофф|standoff)\b/i, value: 'STANDOFF_2' },
  { re: /\b(steam|стим)\b/i, value: 'STEAM' },
  { re: /\b(roblox|роблокс)\b/i, value: 'ROBLOX' },
  { re: /\b(rp\s*проект|рп\s*проект|rp_projects)\b/i, value: 'RP_PROJECTS' },
  { re: /\b(brawl\s*stars|бравл)\b/i, value: 'BRAWL_STARS' },
  { re: /\b(pubg|пубг|mobile\s*legends|млбб|cs:?\s*go|ксго|valorant|валорант)\b/i, value: 'OTHER' },
  { re: /\b(другое|other)\b/i, value: 'OTHER' },
];

const SUB_ALIASES: Array<{ re: RegExp; value: ProductSubcategory; prefer?: ProductCategory }> = [
  { re: /\b(gold|голд[аы]?)\b/i, value: 'STANDOFF_GOLD', prefer: 'STANDOFF_2' },
  { re: /\b(робукс|robux)\b/i, value: 'ROBLOX_ROBUX', prefer: 'ROBLOX' },
  { re: /\b(вирт[ыа]?|virts?)\b/i, value: 'RP_VIRTS', prefer: 'RP_PROJECTS' },
  { re: /\b(пополнен\w*|top\s*-?up|валют[аы]?)\b/i, value: 'STEAM_TOPUP', prefer: 'STEAM' },
  { re: /\b(ключ\w*|keys?)\b/i, value: 'STEAM_KEYS', prefer: 'STEAM' },
  { re: /\b(скин\w*|skins?)\b/i, value: 'STEAM_SKINS' },
  { re: /\b(аккаунт\w*|accounts?)\b/i, value: 'STEAM_ACCOUNTS' },
  { re: /\b(предмет\w*|items?)\b/i, value: 'ROBLOX_ITEMS' },
  { re: /\b(донат|donate)\b/i, value: 'BRAWL_DONATE', prefer: 'BRAWL_STARS' },
  { re: /\b(буст|boost)\b/i, value: 'BRAWL_BOOST', prefer: 'BRAWL_STARS' },
];

const CREATE_PREFIX = /^(?:создай\s+(?:новый\s+)?товар|новый\s+товар|создать\s+(?:новый\s+)?товар|добавить\s+товар)\s*/i;

function labeled(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-–]?\\s*(.+)`, 'i');
    const m = text.match(re);
    if (m?.[1]) {
      const line = m[1].split(/\n/)[0]?.trim();
      if (line) return line;
    }
  }
  return undefined;
}

function defaultSubcategory(category: ProductCategory): ProductSubcategory {
  const allowed = SUBCATEGORIES_BY_CATEGORY[category];
  const preferred = allowed.find((s) => s.endsWith('_OTHER') || s.endsWith('_MISC') || s.endsWith('_ITEMS'));
  return preferred ?? allowed[0]!;
}

export class EntityExtractor {
  extract(text: string, opts?: { category?: ProductCategory | null }): ExtractedProductFields {
    const raw = text.trim();
    const out: ExtractedProductFields = {};
    if (!raw) return out;

    // Do not use bare «товар» — it matches «создай товар PUBG…»
    const titleLabeled = labeled(raw, ['название', 'title', 'название товара']);
    if (titleLabeled) out.title = titleLabeled.slice(0, 32);

    const catLabeled = labeled(raw, ['категория', 'category']);
    if (catLabeled) {
      const cat = this.parseCategory(catLabeled);
      if (cat) out.category = cat;
    }

    const subLabeled = labeled(raw, ['подкатегория', 'subcategory', 'под\\s*категория']);
    if (subLabeled) {
      const sub = this.parseSubcategory(subLabeled, out.category ?? opts?.category);
      if (sub) out.subcategory = sub;
    }

    const priceLabeled = labeled(raw, ['цена', 'price', 'стоимость']);
    if (priceLabeled) {
      const p = this.parsePrice(priceLabeled);
      if (p != null) out.priceRubles = p;
    }

    const qtyLabeled = labeled(raw, ['количество', 'quantity', 'кол-во', 'колво']);
    if (qtyLabeled) {
      const q = this.parseQuantity(qtyLabeled);
      if (q != null) out.quantity = q;
    }

    const descLabeled = labeled(raw, ['описание', 'description']);
    if (descLabeled) {
      if (/^(нет|пропустить|-|—)$/i.test(descLabeled)) out.descriptionSkipped = true;
      else out.description = descLabeled.slice(0, 20_000);
    }
    if (/без\s+описания|без\s+опис/i.test(raw)) out.descriptionSkipped = true;

    // Free-form category/subcategory words anywhere
    if (!out.category) {
      for (const a of CATEGORY_ALIASES) {
        if (a.re.test(raw)) { out.category = a.value; break; }
      }
    }
    if (!out.subcategory) {
      for (const a of SUB_ALIASES) {
        if (!a.re.test(raw)) continue;
        if (a.prefer && out.category && out.category !== a.prefer && opts?.category !== a.prefer) continue;
        const cat = out.category ?? opts?.category ?? a.prefer;
        if (cat && !SUBCATEGORIES_BY_CATEGORY[cat].includes(a.value)) continue;
        out.subcategory = a.value;
        if (!out.category && a.prefer) out.category = a.prefer;
        break;
      }
    }

    // «за 500 ₽» / bare «500 ₽»
    if (out.priceRubles == null) {
      const za = raw.match(/за\s+(\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб(?:лей|ля|ль)?\.?)?/i);
      if (za) out.priceRubles = this.parsePrice(za[1]!);
    }
    if (out.priceRubles == null) {
      const onlyPrice = raw.match(/^(?:цена\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб(?:лей|ля|ль)?\.?)?$/i);
      if (onlyPrice) out.priceRubles = this.parsePrice(onlyPrice[1]);
      else {
        const inline = raw.match(/(?:^|\s)(\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб(?:лей|ля|ль)?\.?)/i);
        if (inline) out.priceRubles = this.parsePrice(inline[1]);
      }
    }

    // «10 штук» / «10 шт»
    if (out.quantity == null) {
      const shtuk = raw.match(/(\d{1,5})\s*(?:шт(?:\.|ук[аиеу]?)?)/i);
      if (shtuk) out.quantity = this.parseQuantity(shtuk[1]!);
    }
    if (out.quantity == null) {
      const onlyQty = raw.match(/^(?:количество\s*)?(\d{1,5})$/i);
      if (onlyQty && out.priceRubles == null) out.quantity = this.parseQuantity(onlyQty[1]);
    }

    // Title from free-form remainder: «PUBG за 500 ₽, 10 штук»
    if (!out.title) {
      let candidate = raw
        .replace(CREATE_PREFIX, '')
        .replace(/за\s+\d+(?:[.,]\d{1,2})?\s*(?:₽|руб(?:лей|ля|ль)?\.?)?/gi, ' ')
        .replace(/\d+(?:[.,]\d{1,2})?\s*(?:₽|руб(?:лей|ля|ль)?\.?)/gi, ' ')
        .replace(/\d{1,5}\s*(?:шт(?:\.|ук[аиеу]?)?)/gi, ' ')
        .replace(/\b(?:цена|количество|кол-во|без\s+описания)\b/gi, ' ')
        .replace(/[,:;]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (
        candidate
        && candidate.length >= 2
        && candidate.length <= 32
        && !/\n/.test(candidate)
        && !/^(опубликовать|изменить|отмена)/i.test(candidate)
      ) {
        out.title = candidate.slice(0, 32);
      }
    }

    // Whole message as title when nothing else
    const hasStructured = Boolean(
      out.category || out.subcategory || out.priceRubles != null || out.quantity != null
      || out.description || out.descriptionSkipped || titleLabeled,
    );
    if (!out.title && !hasStructured) {
      const cleaned = raw.replace(CREATE_PREFIX, '').trim();
      if (cleaned && cleaned.length <= 32 && !/\n/.test(cleaned) && !/^(опубликовать|изменить|отмена)/i.test(cleaned)) {
        out.title = cleaned;
      }
    }

    if (out.category && !out.subcategory) {
      const allowed = SUBCATEGORIES_BY_CATEGORY[out.category];
      for (const a of SUB_ALIASES) {
        if (a.re.test(raw) && allowed.includes(a.value)) {
          out.subcategory = a.value;
          break;
        }
      }
      // Dense one-shot create: pick a sensible default subcategory
      if (!out.subcategory && (out.title || out.priceRubles != null)) {
        out.subcategory = defaultSubcategory(out.category);
      }
    }

    // Platform min title length is 5 — pad short game names (PUBG → PUBG лот)
    if (out.title && out.title.trim().length >= 2 && out.title.trim().length < 5) {
      out.title = `${out.title.trim()} лот`.slice(0, 32);
    }

    return out;
  }

  parseCategory(text: string): ProductCategory | undefined {
    const t = text.trim();
    const upper = t.toUpperCase().replace(/\s+/g, '_');
    if ((Object.keys(SUBCATEGORIES_BY_CATEGORY) as ProductCategory[]).includes(upper as ProductCategory)) {
      return upper as ProductCategory;
    }
    for (const a of CATEGORY_ALIASES) {
      if (a.re.test(t)) return a.value;
    }
    return undefined;
  }

  parseSubcategory(text: string, category?: ProductCategory | null): ProductSubcategory | undefined {
    const t = text.trim();
    const upper = t.toUpperCase().replace(/\s+/g, '_');
    const all = Object.values(SUBCATEGORIES_BY_CATEGORY).flat();
    if (all.includes(upper as ProductSubcategory)) {
      const sub = upper as ProductSubcategory;
      if (category && !SUBCATEGORIES_BY_CATEGORY[category].includes(sub)) return undefined;
      return sub;
    }
    for (const a of SUB_ALIASES) {
      if (a.re.test(t)) {
        if (category && !SUBCATEGORIES_BY_CATEGORY[category].includes(a.value)) continue;
        return a.value;
      }
    }
    const labelMap: Record<string, ProductSubcategory> = {
      'пополнение': 'STEAM_TOPUP',
      'валюта': 'STEAM_TOPUP',
      'ключи': 'STEAM_KEYS',
      'скины': 'STEAM_SKINS',
      'аккаунты': 'STEAM_ACCOUNTS',
      'робуксы': 'ROBLOX_ROBUX',
      'предметы': 'ROBLOX_ITEMS',
      'вирты': 'RP_VIRTS',
      'gold': 'STANDOFF_GOLD',
      'голда': 'STANDOFF_GOLD',
      'донат': 'BRAWL_DONATE',
      'буст': 'BRAWL_BOOST',
      'другое': 'STEAM_OTHER',
    };
    const key = t.toLowerCase();
    const mapped = labelMap[key];
    if (mapped) {
      if (category && !SUBCATEGORIES_BY_CATEGORY[category].includes(mapped)) {
        const others = SUBCATEGORIES_BY_CATEGORY[category].filter((s) => s.endsWith('_OTHER') || s.endsWith('_MISC'));
        return others[0];
      }
      return mapped;
    }
    return undefined;
  }

  parsePrice(text: string): number | undefined {
    const m = text.replace(/\s/g, '').match(/(\d+(?:[.,]\d{1,2})?)/);
    if (!m) return undefined;
    const n = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 50_000) return undefined;
    return n;
  }

  parseQuantity(text: string): number | undefined {
    const m = text.match(/(\d{1,5})/);
    if (!m) return undefined;
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > 10_000) return undefined;
    return n;
  }
}
