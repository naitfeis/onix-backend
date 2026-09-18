import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
// warm the pool first
await (await pool.connect()).release();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool), transactionOptions: { maxWait: 15000, timeout: 15000 } });

try {
  await prisma.$transaction(async (tx) => {
    console.log('trying $queryRaw with cast to text...');
    const r1 = await tx.$queryRaw`SELECT pg_advisory_xact_lock(${123n})::text as ok`;
    console.log('queryRaw cast result', JSON.stringify(r1));
  });
  console.log('CAST_OK');
} catch (e) {
  console.error('CAST_ERROR', e && e.message);
}

try {
  await prisma.$transaction(async (tx) => {
    console.log('trying $executeRaw (no cast)...');
    const r2 = await tx.$executeRaw`SELECT pg_advisory_xact_lock(${456n})`;
    console.log('executeRaw result (rows affected)', r2);
  });
  console.log('EXECUTE_OK');
} catch (e) {
  console.error('EXECUTE_ERROR', e && e.message);
}

await prisma.$disconnect();
await pool.end();
