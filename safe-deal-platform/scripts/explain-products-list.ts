/**
 * EXPLAIN ANALYZE for the hot GET /api/products list shape (guest, status=ACTIVE, newest).
 * Usage: npx tsx safe-deal-platform/scripts/explain-products-list.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL missing');
  const pool = new Pool({ connectionString, max: 2 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  // Approximate Prisma list: Product ACTIVE order by createdAt desc limit 10
  // + seller join fields (Prisma may split into 2 queries; we EXPLAIN the main filter).
  const sql = `
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT p.id, p."lotNumber", p.title, p."priceCents", p.quantity, p.category,
       p.subcategory, p.status, p."autoDeliver", p."createdAt", p."sellerId",
       u.id, u."onixId", u."telegramNick", u."displayName", u."avatarUrl",
       u."ratingAverage", u."ratingCount", u."completedSales", u."lastSeenAt",
       u."isAdmin", u."isSupport", u."platformStatus"
FROM "Product" p
INNER JOIN "User" u ON u.id = p."sellerId"
WHERE p.status = 'ACTIVE'
ORDER BY p."createdAt" DESC
LIMIT 10;
`;

  const rows = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(sql);
  for (const row of rows) {
    console.log(row['QUERY PLAN']);
  }

  // Index presence check
  const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(`
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('Product', 'User', 'Favorite', 'Follow', 'ProductViewUnique')
ORDER BY tablename, indexname;
`);
  console.log('\n--- INDEXES ---');
  for (const idx of indexes) {
    console.log(`${idx.indexname}\n  ${idx.indexdef}`);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
