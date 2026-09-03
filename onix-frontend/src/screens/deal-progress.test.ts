import { describe, expect, it } from 'vitest';
import { DEAL_PHASES, dealProgress } from './shared';

describe('deal phases', () => {
  it('uses five escrow steps ending at payout', () => {
    expect([...DEAL_PHASES]).toEqual(['Оплата', 'Сейф', 'Передача', 'Подтверждение', 'Выплата']);
    expect(dealProgress('PENDING')).toBe(0);
    expect(dealProgress('PAYMENT_HOLD')).toBe(1);
    expect(dealProgress('DELIVERING')).toBe(3);
    expect(dealProgress('COMPLETED')).toBe(4);
  });
});
