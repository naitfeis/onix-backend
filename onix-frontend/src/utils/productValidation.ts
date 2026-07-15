import type { ProductDraft } from '../api/contracts';

export function validateDraft(draft: ProductDraft): string[] {
  const errors: string[] = [];
  if (draft.title.trim().length < 5) errors.push('Название должно содержать минимум 5 символов');
  if (draft.description.trim().length < 10) errors.push('Опишите товар подробнее');
  const price = Number(draft.priceRubles);
  if (!Number.isFinite(price) || price < 10 || price > 50_000) errors.push('Цена должна быть от 10 до 50 000 ₽');
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1) errors.push('Укажите корректное количество');
  if (draft.autoDeliver && !(draft.deliveryText?.trim())) {
    errors.push('Для автовыдачи укажите текст товара');
  }
  return errors;
}
