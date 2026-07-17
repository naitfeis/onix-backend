import type { ProductDraft } from '../api/contracts';

const NO_MIN_SUB = new Set(['STANDOFF_GOLD', 'ROBLOX_ROBUX', 'STEAM_TOPUP', 'RP_VIRTS']);

export function minPriceRubles(subcategory?: string): number {
  return subcategory && NO_MIN_SUB.has(subcategory) ? 0 : 10;
}

export function validateDraft(
  draft: ProductDraft,
  opts?: { keepDeliverySecret?: boolean },
): string[] {
  const errors: string[] = [];
  const title = draft.title.trim();
  if (title.length < 5) errors.push('Название должно содержать минимум 5 символов');
  if (title.length > 32) errors.push('Название не длиннее 32 символов');
  const price = Number(draft.priceRubles);
  const minRub = minPriceRubles(draft.subcategory);
  if (!Number.isFinite(price) || price < minRub || price > 50_000) {
    errors.push(`Цена должна быть от ${minRub} до 50 000 ₽`);
  }
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1) errors.push('Укажите корректное количество');
  if (draft.autoDeliver && !(draft.deliveryText?.trim()) && !opts?.keepDeliverySecret) {
    errors.push('Для автовыдачи укажите текст товара');
  }
  return errors;
}
