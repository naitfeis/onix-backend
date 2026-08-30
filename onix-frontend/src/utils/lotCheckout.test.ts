import { describe, expect, it } from 'vitest';
import { LOT_PAY_METHODS, lotDisplayTitle, lotShortDescription, quoteLotCheckout } from './lotCheckout';

describe('quoteLotCheckout', () => {
  it('covers a cheap lot from balance with no fee', () => {
    const q = quoteLotCheckout(100_000, 4_000_000, 'SBP');
    expect(q.fromBalanceCents).toBe(100_000);
    expect(q.remainingCents).toBe(0);
    expect(q.feeCents).toBe(0);
    expect(q.externalCents).toBe(0);
    expect(q.coveredByBalance).toBe(true);
  });

  it('falls back to the short description when the lot has no title', () => {
    expect(lotDisplayTitle({ title: '  ', description: '1000 рублей по логину стим\nдетали' })).toBe('1000 рублей по логину стим');
    expect(lotShortDescription({ title: '', description: 'Пополнение Steam' })).toBe('Пополнение Steam');
  });

  it('splits 40 RUB on balance and 960 leftover with SBP 1%', () => {
    const q = quoteLotCheckout(100_000, 4_000, 'SBP');
    expect(q.fromBalanceCents).toBe(4_000);
    expect(q.remainingCents).toBe(96_000);
    expect(q.feeCents).toBe(960);
    expect(q.externalCents).toBe(96_960);
  });

  it('does not offer cryptocurrency as a checkout method', () => {
    expect(LOT_PAY_METHODS).toEqual(['BALANCE', 'SBP', 'CARD']);
  });

  it('applies 4% card fee only to the leftover', () => {
    const q = quoteLotCheckout(100_000, 4_000, 'CARD');
    expect(q.feeCents).toBe(3_840);
    expect(q.externalCents).toBe(99_840);
  });
});
