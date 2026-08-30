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
      acceptedRules: true,
    })).toEqual([]);
  });

  it('rejects unsafe bounds and incomplete fields', () => {
    const errors = validateDraft({
      title: 'x', description: '', priceRubles: '50001', quantity: 0, category: 'Другое', subcategory: '', acceptedRules: true,
    });
    expect(errors).toHaveLength(3);
  });

  it('allows prices from 0.1 ₽ for gold/robux/steam/virts', () => {
    expect(validateDraft({
      title: 'Robux pack',
      description: '',
      priceRubles: '0.1',
      quantity: 1,
      category: 'Roblox',
      subcategory: 'ROBLOX_ROBUX',
      acceptedRules: true,
    })).toEqual([]);
  });

  it('rejects free (0 ₽) listings even for soft-min subcategories', () => {
    const errors = validateDraft({
      title: 'Robux pack',
      description: '',
      priceRubles: '0',
      quantity: 1,
      category: 'Roblox',
      subcategory: 'ROBLOX_ROBUX',
      acceptedRules: true,
    });
    expect(errors.some((e) => e.includes('Цена'))).toBe(true);
  });
});
