import pg from 'pg';
const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
try {
  await c.connect();
  const tables = await c.query(`select table_name from information_schema.tables where table_schema='public' order by 1`);
  console.log('TABLE_COUNT', tables.rows.length);
  console.log('SAMPLE_TABLES', tables.rows.slice(0, 15).map(r => r.table_name));
  const hasMigrations = tables.rows.some(r => r.table_name === '_prisma_migrations');
  console.log('HAS_PRISMA_MIGRATIONS_TABLE', hasMigrations);
  if (hasMigrations) {
    const m = await c.query('select count(*) from "_prisma_migrations"');
    console.log('MIGRATIONS_ROW_COUNT', m.rows[0].count);
  }
  const hasUserTable = tables.rows.some(r => r.table_name === 'User');
  if (hasUserTable) {
    const u = await c.query('select count(*) from "User"');
    console.log('USER_ROW_COUNT', u.rows[0].count);
  }
  await c.end();
} catch (e) {
  console.error('CONNECT_ERROR', e && e.message, e && e.code);
  process.exitCode = 1;
}
