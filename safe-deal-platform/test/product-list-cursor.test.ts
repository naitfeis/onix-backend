import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeProductListCursor,
  encodeProductListCursor,
  productListCursorWhere,
} from '../src/marketplace/product-list-cursor';

describe('product-list-cursor', () => {
  it('round-trips newest keyset', () => {
    const encoded = encodeProductListCursor({
      sort: 'newest',
      id: 'cuid_abc',
      createdAt: '2026-09-10T10:00:00.000Z',
    });
    const decoded = decodeProductListCursor(encoded, 'newest');
    assert.ok(decoded);
    assert.equal(decoded!.id, 'cuid_abc');
    assert.equal(decoded!.createdAt, '2026-09-10T10:00:00.000Z');
    const where = productListCursorWhere(decoded!);
    assert.ok(where.OR);
  });

  it('rejects cursor when sort mismatches', () => {
    const encoded = encodeProductListCursor({
      sort: 'price_asc',
      id: 'x',
      priceCents: '100',
    });
    assert.equal(decodeProductListCursor(encoded, 'newest'), null);
  });

  it('round-trips rating keyset shape used by frontend', () => {
    const raw = 'rating|pid|4.5|12|3|10';
    const decoded = decodeProductListCursor(raw, 'rating');
    assert.ok(decoded);
    assert.equal(decoded!.ratingAverage, '4.5');
    assert.equal(decoded!.ratingCount, 12);
    assert.equal(decoded!.completedSales, 3);
    assert.equal(decoded!.warrantyHours, 10);
  });
});
