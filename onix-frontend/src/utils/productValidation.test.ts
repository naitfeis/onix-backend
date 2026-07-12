import { describe, expect, it } from 'vitest';
import { validateDraft } from './productValidation';

describe('validateDraft', () => {
  it('accepts a complete marketplace draft', () => {
    expect(validateDraft({
      title: 'Butterfly Fade',
      description: 'Передача внутри безопасной сделки ONIX.',
      priceRubles: '8500',
      quantity: 1,
      category: 'Steam',
      subcategory: 'Инвентарь',
    })).toEqual([]);
  });

  it('rejects unsafe bounds and incomplete fields', () => {
    const errors = validateDraft({
      title: 'x', description: '', priceRubles: '50001', quantity: 0, category: 'Другое', subcategory: '',
    });
    expect(errors).toHaveLength(4);
  });
});
