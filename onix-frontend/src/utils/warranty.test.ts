import { describe, expect, it } from 'vitest';
import { WARRANTY_DEFAULT_HOURS, formatDealCountdown, formatWarrantyHours, lotWarrantyBadge } from './warranty';

describe('lotWarrantyBadge', () => {
  it('defaults to 10 hours when the listing omits warranty', () => {
    expect(WARRANTY_DEFAULT_HOURS).toBe(10);
    expect(lotWarrantyBadge({})).toBe('Гарантия: 10 часов');
  });

  it('prefers the server label and formats days otherwise', () => {
    expect(lotWarrantyBadge({ warrantyLabel: 'Гарантия: 10 часов' })).toBe('Гарантия: 10 часов');
    expect(formatWarrantyHours(48)).toBe('Гарантия: 2 дня');
  });

  it('formats the payout warranty countdown', () => {
    const now = Date.parse('2026-09-03T12:00:00.000Z');
    expect(formatDealCountdown('2026-09-03T22:00:00.000Z', now)).toBe('10:00:00');
    expect(formatDealCountdown('2026-09-03T11:00:00.000Z', now)).toBe('00:00:00');
    expect(formatDealCountdown(null, now)).toBeNull();
  });
});
