import { describe, expect, it, beforeEach } from 'vitest';
import {
  hideCatalogProduct,
  isCatalogHidden,
  resetCatalogVisibility,
  showCatalogProduct,
  visibleProducts,
} from './catalogVisibility';

describe('catalogVisibility', () => {
  beforeEach(() => resetCatalogVisibility());

  it('drops reserved and hidden lots so a stale catalog GET cannot resurrect them', () => {
    hideCatalogProduct('sold-1');
    const next = visibleProducts([
      { id: 'sold-1', status: 'ACTIVE' },
      { id: 'live-1', status: 'ACTIVE' },
      { id: 'reserved-1', status: 'RESERVED' },
    ]);
    expect(next.map((row) => row.id)).toEqual(['live-1']);
    expect(isCatalogHidden('sold-1')).toBe(true);
  });

  it('brings a lot back after a failed pay or a cancel restore', () => {
    hideCatalogProduct('lot-1');
    showCatalogProduct('lot-1');
    expect(visibleProducts([{ id: 'lot-1', status: 'ACTIVE' }])).toHaveLength(1);
  });
});
