import { describe, expect, it } from 'vitest';
import { WARRANTY_DEFAULT_HOURS, formatWarrantyHours, lotWarrantyBadge } from './warranty';

describe('lotWarrantyBadge', () => {
  it('defaults to 10 hours when the listing omits warranty', () => {
    expect(WARRANTY_DEFAULT_HOURS).toBe(10);
    expect(lotWarrantyBadge({})).toBe('Гарантия: 10 часов');
  });

  it('prefers the server label and formats days otherwise', () => {
    expect(lotWarrantyBadge({ warrantyLabel: 'Гарантия: 10 часов' })).toBe('Гарантия: 10 часов');
    expect(formatWarrantyHours(48)).toBe('Гарантия: 2 дня');
  });
});
