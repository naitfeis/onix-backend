import { Prisma } from '@prisma/client';

export type ProductListSort =
  | 'newest'
  | 'price_asc'
  | 'price_desc'
  | 'rating'
  | 'warranty'
  | 'reliability';

export type ProductCursorPayload = {
  sort: ProductListSort;
  id: string;
  createdAt?: string;
  priceCents?: string;
  warrantyHours?: number;
  ratingAverage?: string;
  ratingCount?: number;
  completedSales?: number;
};

const SORTS = new Set<string>([
  'newest', 'price_asc', 'price_desc', 'rating', 'warranty', 'reliability',
]);

/** Encode opaque keyset cursor (shared shape with onix-frontend). */
export function encodeProductListCursor(payload: ProductCursorPayload): string {
  const parts: string[] = [payload.sort, payload.id];
  if (payload.sort === 'price_asc' || payload.sort === 'price_desc') {
    parts.push(payload.priceCents ?? '0');
  } else if (payload.sort === 'warranty') {
    parts.push(String(payload.warrantyHours ?? 10));
  } else if (payload.sort === 'rating' || payload.sort === 'reliability') {
    parts.push(
      payload.ratingAverage ?? '0',
      String(payload.ratingCount ?? 0),
      String(payload.completedSales ?? 0),
      String(payload.warrantyHours ?? 10),
    );
  } else {
    parts.push(payload.createdAt ?? new Date(0).toISOString());
  }
  return parts.join('|');
}

export function decodeProductListCursor(
  raw: string | undefined,
  expectedSort: string,
): ProductCursorPayload | null {
  if (!raw?.trim()) return null;
  const parts = raw.split('|');
  if (parts.length < 3) return null;
  const sort = parts[0]!;
  if (!SORTS.has(sort) || sort !== expectedSort) return null;
  const id = parts[1]?.trim();
  if (!id) return null;

  if (sort === 'price_asc' || sort === 'price_desc') {
    const priceCents = parts[2]!;
    if (!/^\d+$/.test(priceCents)) return null;
    return { sort, id, priceCents };
  }
  if (sort === 'warranty') {
    const warrantyHours = Number(parts[2]);
    if (!Number.isFinite(warrantyHours)) return null;
    return { sort, id, warrantyHours };
  }
  if (sort === 'rating' || sort === 'reliability') {
    if (parts.length < 6) return null;
    const ratingAverage = parts[2]!;
    const ratingCount = Number(parts[3]);
    const completedSales = Number(parts[4]);
    const warrantyHours = Number(parts[5]);
    if (!Number.isFinite(ratingCount) || !Number.isFinite(completedSales) || !Number.isFinite(warrantyHours)) {
      return null;
    }
    return { sort, id, ratingAverage, ratingCount, completedSales, warrantyHours };
  }
  const createdAt = parts[2]!;
  const at = new Date(createdAt);
  if (!Number.isFinite(at.getTime())) return null;
  return { sort: 'newest', id, createdAt: at.toISOString() };
}

/** Keyset WHERE fragment — keeps OFFSET off the hot path when cursor is present. */
export function productListCursorWhere(
  cursor: ProductCursorPayload,
): Prisma.ProductWhereInput {
  if (cursor.sort === 'price_asc') {
    const price = BigInt(cursor.priceCents ?? '0');
    return {
      OR: [
        { priceCents: { gt: price } },
        { AND: [{ priceCents: price }, { id: { gt: cursor.id } }] },
      ],
    };
  }
  if (cursor.sort === 'price_desc') {
    const price = BigInt(cursor.priceCents ?? '0');
    return {
      OR: [
        { priceCents: { lt: price } },
        { AND: [{ priceCents: price }, { id: { lt: cursor.id } }] },
      ],
    };
  }
  if (cursor.sort === 'warranty') {
    const wh = cursor.warrantyHours ?? 10;
    return {
      OR: [
        { warrantyHours: { lt: wh } },
        { AND: [{ warrantyHours: wh }, { id: { lt: cursor.id } }] },
      ],
    };
  }
  if (cursor.sort === 'rating' || cursor.sort === 'reliability') {
    const avg = new Prisma.Decimal(cursor.ratingAverage ?? '0');
    const count = cursor.ratingCount ?? 0;
    const sales = cursor.completedSales ?? 0;
    const wh = cursor.warrantyHours ?? 10;
    if (cursor.sort === 'rating') {
      return {
        OR: [
          { seller: { ratingAverage: { lt: avg } } },
          { AND: [{ seller: { ratingAverage: avg } }, { seller: { ratingCount: { lt: count } } }] },
          {
            AND: [
              { seller: { ratingAverage: avg } },
              { seller: { ratingCount: count } },
              { id: { lt: cursor.id } },
            ],
          },
        ],
      };
    }
    return {
      OR: [
        { seller: { ratingAverage: { lt: avg } } },
        { AND: [{ seller: { ratingAverage: avg } }, { seller: { ratingCount: { lt: count } } }] },
        {
          AND: [
            { seller: { ratingAverage: avg } },
            { seller: { ratingCount: count } },
            { warrantyHours: { lt: wh } },
          ],
        },
        {
          AND: [
            { seller: { ratingAverage: avg } },
            { seller: { ratingCount: count } },
            { warrantyHours: wh },
            { seller: { completedSales: { lt: sales } } },
          ],
        },
        {
          AND: [
            { seller: { ratingAverage: avg } },
            { seller: { ratingCount: count } },
            { warrantyHours: wh },
            { seller: { completedSales: sales } },
            { id: { lt: cursor.id } },
          ],
        },
      ],
    };
  }
  const createdAt = new Date(cursor.createdAt ?? 0);
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { AND: [{ createdAt }, { id: { lt: cursor.id } }] },
    ],
  };
}
