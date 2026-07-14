/**
 * Re-runnable IdentityLink backfill (Phase 1).
 * Prefer the SQL in migration for prod; this script is for ops re-runs / staging.
 *
 * Usage: npx tsx safe-deal-platform/scripts/backfill-identity-links.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { backfillTelegramIdentityLinks } from '../src/identity-link';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const result = await backfillTelegramIdentityLinks(prisma);
    console.log(JSON.stringify({ ok: true, ...result }));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
