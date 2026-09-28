import { describe, expect, it } from 'vitest';
import type { Deal } from '../api/contracts';
import { encodeOrderListCursor, isValidOrderCursor } from './orderListCursor';

const deal = (id: string, createdAt: string, totalAmountCents: string): Deal => ({
  id,
  createdAt,
  totalAmountCents,
} as Deal);

describe('encodeOrderListCursor', () => {
  it('uses the ISO date for time sorts, matching decodeOrderListCursor', () => {
    const cursor = encodeOrderListCursor('newest', deal('42', '2026-03-01T10:00:00.000Z', '99900'));
    expect(cursor).toBe('2026-03-01T10:00:00.000Z|42');
    expect(isValidOrderCursor(cursor, 'newest')).toBe(true);
  });

  it('uses integer cents for amount sorts', () => {
    // Regression guard: a date cursor under an amount sort would make the
    // backend skip the whole page (it parses the left side as BigInt).
    const expensive = encodeOrderListCursor('expensive', deal('7', '2026-03-01T10:00:00.000Z', '250000'));
    expect(expensive).toBe('250000|7');
    expect(isValidOrderCursor(expensive, 'expensive')).toBe(true);
    expect(isValidOrderCursor(expensive, 'newest')).toBe(false);
  });

  it('never emits a cursor the backend would silently ignore', () => {
    const cheap = encodeOrderListCursor('cheap', deal('9', '2026-03-01T10:00:00.000Z', '100'));
    expect(isValidOrderCursor(cheap, 'cheap')).toBe(true);
    const oldest = encodeOrderListCursor('oldest', deal('9', '2026-03-01T10:00:00.000Z', '100'));
    expect(isValidOrderCursor(oldest, 'oldest')).toBe(true);
  });

  it('falls back to epoch when createdAt is missing', () => {
    const cursor = encodeOrderListCursor('newest', deal('3', '', '100'));
    expect(cursor).toBe(`${new Date(0).toISOString()}|3`);
    expect(isValidOrderCursor(cursor, 'newest')).toBe(true);
  });
});

describe('isValidOrderCursor', () => {
  it('rejects malformed cursors', () => {
    expect(isValidOrderCursor('no-separator', 'newest')).toBe(false);
    expect(isValidOrderCursor('|42', 'newest')).toBe(false);
    expect(isValidOrderCursor('2026-03-01T10:00:00.000Z|not-a-number', 'newest')).toBe(false);
    expect(isValidOrderCursor('2026-03-01T10:00:00.000Z|', 'newest')).toBe(false);
    expect(isValidOrderCursor('', 'newest')).toBe(false);
  });

  it('rejects a non-integer amount key', () => {
    expect(isValidOrderCursor('12.5|42', 'expensive')).toBe(false);
  });
});