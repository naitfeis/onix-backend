/** Client-side catalog guard: hide paid lots even if a stale GET still lists them. */

const hiddenProductIds = new Set<string>();

export function hideCatalogProduct(id: string): void {
  if (!id) return;
  hiddenProductIds.add(id);
}

export function showCatalogProduct(id: string): void {
  if (!id) return;
  hiddenProductIds.delete(id);
}

export function isCatalogHidden(id: string): boolean {
  return hiddenProductIds.has(id);
}

export function visibleProducts<T extends { id: string; status?: string }>(list: T[]): T[] {
  return list.filter((product) => product.status === 'ACTIVE' && !hiddenProductIds.has(product.id));
}

/** Test helper — not used by the app. */
export function resetCatalogVisibility(): void {
  hiddenProductIds.clear();
}
