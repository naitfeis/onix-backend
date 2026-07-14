import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const plan = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
      `EXPLAIN (FORMAT TEXT)
       SELECT id FROM "Session"
       WHERE "previousRefreshHash" = $1
       LIMIT 1`,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    for (const row of plan) {
      console.log(row['QUERY PLAN']);
    }

    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'Session' AND indexname = 'Session_previousRefreshHash_idx'`,
    );
    console.log('INDEX_PRESENT=', indexes.length === 1 ? 'yes' : 'no');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
