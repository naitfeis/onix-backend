/**
 * Keyset cursor for GET /api/orders — mirrors
 * safe-deal-platform/src/escrow.module.ts:decodeOrderListCursor.
 *
 * Format: `<sortKey>|<id>` where sortKey is
 *   newest/oldest  → ISO createdAt
 *   expensive/cheap → totalAmountCents
 * Backend rejects malformed cursors by ignoring them, so this must match exactly.
 */
import type { Deal, OrderListSort } from '../api/contracts';

export function encodeOrderListCursor(sort: OrderListSort, last: Deal): string {
  const sortKey = sort === 'expensive' || sort === 'cheap'
    ? String(last.totalAmountCents ?? '0')
    : (last.createdAt || new Date(0).toISOString());
  return `${sortKey}|${last.id}`;
}

const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T/;

/**
 * Amount sorts use integer cents; the rest use an ISO timestamp.
 *
 * Date parsing alone is not enough — `new Date('250000')` is finite, so an
 * amount key would pass a time-sort check. The ISO shape is asserted first.
 */
export function isValidOrderCursor(cursor: string, sort: OrderListSort): boolean {
  const sep = cursor.indexOf('|');
  if (sep <= 0) return false;
  const left = cursor.slice(0, sep);
  const id = cursor.slice(sep + 1).trim();
  if (!/^\d+$/.test(id)) return false;
  if (sort === 'expensive' || sort === 'cheap') return /^\d+$/.test(left);
  return ISO_PREFIX.test(left) && Number.isFinite(new Date(left).getTime());
}