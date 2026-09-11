import type { ProductDraft } from '../api/contracts';
import { DESCRIPTION_MAX_CHARS } from '../components/DescriptionEditor';
import { parseRublesToCents } from './moneyCents';

const SOFT_MIN_SUB = new Set(['STANDOFF_GOLD', 'ROBLOX_ROBUX', 'STEAM_TOPUP', 'RP_VIRTS']);

function plainDescriptionLength(html: string): number {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim().length;
}

export function minPriceRubles(subcategory?: string): number {
  return subcategory && SOFT_MIN_SUB.has(subcategory) ? 0.1 : 10;
}

export function validateDraft(
  draft: ProductDraft,
  opts?: { keepDeliverySecret?: boolean; minWarrantyHours?: number },
): string[] {
  const errors: string[] = [];
  const title = draft.title.trim();
  if (title.length < 5) errors.push('Название должно содержать минимум 5 символов');
  if (title.length > 32) errors.push('Название не длиннее 32 символов');
  if (plainDescriptionLength(draft.description || '') > DESCRIPTION_MAX_CHARS) {
    errors.push(`Описание не длиннее ${DESCRIPTION_MAX_CHARS} символов`);
  }
  const priceCents = parseRublesToCents(draft.priceRubles);
  const minRub = minPriceRubles(draft.subcategory);
  const minCents = parseRublesToCents(minRub);
  if (!Number.isSafeInteger(priceCents) || priceCents < minCents || priceCents > 5_000_000) {
    errors.push(`Цена должна быть от ${minRub} до 50 000 ₽`);
  }
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1) errors.push('Укажите корректное количество');
  if (draft.autoDeliver && !(draft.deliveryText?.trim()) && !opts?.keepDeliverySecret) {
    errors.push('Для автовыдачи укажите текст товара');
  }
  if (!opts?.keepDeliverySecret && !draft.acceptedRules) {
    errors.push('Нужно согласиться с правилами платформы');
  }
  const minWarranty = opts?.minWarrantyHours ?? 5;
  const warranty = draft.warrantyHours ?? 10;
  if (!Number.isInteger(warranty) || warranty < minWarranty || warranty > 720) {
    errors.push(
      minWarranty > 5
        ? `Срок гарантии — от ${minWarranty} часов до 30 дней (для новых аккаунтов минимум сутки)`
        : 'Срок гарантии — от 5 часов до 30 дней',
    );
  }
  return errors;
}
