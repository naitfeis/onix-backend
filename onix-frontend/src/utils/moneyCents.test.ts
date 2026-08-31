import { describe, expect, it } from 'vitest';
import { parseRublesToCents, rublesToCentsString } from './moneyCents';

describe('parseRublesToCents', () => {
  it('keeps two-decimal amounts exact without float rounding', () => {
    expect(parseRublesToCents('19.99')).toBe(1999);
    expect(parseRublesToCents('0.1')).toBe(10);
    expect(parseRublesToCents('0,10')).toBe(10);
    expect(parseRublesToCents(10)).toBe(1000);
  });

  it('rejects extra fractions instead of rounding a kopeck up', () => {
    expect(Number.isNaN(parseRublesToCents('10.999'))).toBe(true);
    expect(Number.isNaN(parseRublesToCents(''))).toBe(true);
  });

  it('serializes listing and withdraw payloads as integer strings', () => {
    expect(rublesToCentsString('8500')).toBe('850000');
  });
});
