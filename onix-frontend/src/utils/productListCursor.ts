import type { Product, ProductListSort } from '../api/contracts';

/** Must stay in sync with safe-deal-platform/src/marketplace/product-list-cursor.ts */
export function encodeProductListCursor(sort: ProductListSort | string, product: Product): string {
  const s = sort || 'newest';
  if (s === 'price_asc' || s === 'price_desc') {
    return `${s}|${product.id}|${product.priceCents}`;
  }
  if (s === 'warranty') {
    return `${s}|${product.id}|${product.warrantyHours ?? 10}`;
  }
  if (s === 'rating' || s === 'reliability') {
    return [
      s,
      product.id,
      String(product.seller.rating),
      String(product.seller.reviewCount),
      String(product.seller.salesCount),
      String(product.warrantyHours ?? 10),
    ].join('|');
  }
  return `newest|${product.id}|${product.createdAt}`;
}
