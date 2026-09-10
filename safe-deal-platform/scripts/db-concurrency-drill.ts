/**
 * Real Postgres concurrency drill — NOT the in-memory LedgerModel.
 *
 * Mirrors product-stock.ts: UPDATE … WHERE quantity >= 1 under two parallel clients.
 * Uses a TEMP table so it never touches Product/User money rows.
 *
 * Usage:
 *   $env:CONCURRENCY_DRILL_DATABASE_URL = "<scratch direct neon>"
 *   npm run ops:db-concurrency-drill
 *
 * Or explicit: ALLOW_DB_CONCURRENCY_ON_DATABASE_URL=1 (still refuse pooler / prod-looking hosts).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFiles } from '../src/env';

loadEnvFiles();

const outDir = resolve(process.cwd(), 'ops-drills');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function pickUrl(): string {
  const dedicated = (process.env.CONCURRENCY_DRILL_DATABASE_URL ?? '').trim();
  if (dedicated) return dedicated;
  const allowPrimary = (process.env.ALLOW_DB_CONCURRENCY_ON_DATABASE_URL ?? '').toLowerCase() === '1';
  const primary = (process.env.DATABASE_URL ?? '').trim();
  if (allowPrimary && primary) return primary;
  throw new Error(
    'Set CONCURRENCY_DRILL_DATABASE_URL to a scratch Neon direct URL '
    + '(or ALLOW_DB_CONCURRENCY_ON_DATABASE_URL=1 with DATABASE_URL for explicit drills).',
  );
}

function redact(url: string): { host: string | null; isPooler: boolean; looksProd: boolean } {
  try {
    const u = new URL(url.replace(/^postgresql:/i, 'http:'));
    const host = u.hostname;
    const looksProd = ['onixtg', 'prod', 'production', 'render.com'].some((s) => host.toLowerCase().includes(s));
    return { host, isPooler: /-pooler\./i.test(host), looksProd };
  } catch {
    return { host: null, isPooler: false, looksProd: false };
  }
}

async function main(): Promise<void> {
  const url = pickUrl();
  const meta = redact(url);
  if (meta.isPooler) throw new Error('Concurrency drill requires a direct Postgres endpoint (not -pooler).');
  if (meta.looksProd && (process.env.ALLOW_PROD_CONCURRENCY_DRILL ?? '').toLowerCase() !== 'true') {
    throw new Error('Refusing prod-looking host. Set ALLOW_PROD_CONCURRENCY_DRILL=true only for explicit drills.');
  }

  const { Client } = await import('pg');
  const ssl = url.includes('sslmode=disable') ? false : { rejectUnauthorized: false };
  const connect = async () => {
    const c = new Client({
      connectionString: url,
      ssl,
      connectionTimeoutMillis: 20_000,
      keepAlive: true,
    });
    await c.connect();
    await c.query('SELECT 1');
    return c;
  };

  // Scratch table (not TEMP) so two sessions can race the same row.
  const table = `ops_stock_drill_${Date.now()}`;
  const setup = await connect();

  let clients: Awaited<ReturnType<typeof connect>>[] = [];
  try {
    clients = await Promise.all([connect(), connect()]);
    await setup.query(`CREATE TABLE "${table}" (id text PRIMARY KEY, quantity int NOT NULL)`);
    await setup.query(`INSERT INTO "${table}" (id, quantity) VALUES ('sku-1', 1)`);

    const race = await Promise.all(
      clients.map(async (c) => {
        const r = await c.query(
          `UPDATE "${table}" SET quantity = quantity - 1
           WHERE id = 'sku-1' AND quantity >= 1
           RETURNING id, quantity`,
        );
        return r.rowCount ?? 0;
      }),
    );

    const winners = race.filter((n) => n === 1).length;
    const losers = race.filter((n) => n === 0).length;
    const left = await setup.query<{ quantity: number }>(`SELECT quantity FROM "${table}" WHERE id = 'sku-1'`);

    const report = {
      ok: winners === 1 && losers === 1 && Number(left.rows[0]?.quantity) === 0,
      mode: 'db-concurrency-drill',
      stampedAt: new Date().toISOString(),
      target: { host: meta.host, isPooler: meta.isPooler },
      table,
      winners,
      losers,
      quantityAfter: left.rows[0]?.quantity ?? null,
      mirrors: 'safe-deal-platform/src/economy/wallet/product-stock.ts updateMany quantity gte',
      note: 'Real Postgres parallel UPDATE — not LedgerModel in-memory. CI unit tests remain in-memory by design.',
    };

    mkdirSync(outDir, { recursive: true });
    const path = resolve(outDir, `db-concurrency-${stamp}.json`);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    const evidenceDir = resolve(process.cwd(), 'docs/architecture/ops-evidence');
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(resolve(evidenceDir, 'db-concurrency-latest.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, archived: path }, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await setup.query(`DROP TABLE IF EXISTS "${table}"`).catch(() => undefined);
    await setup.end().catch(() => undefined);
    await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
  }
}

void main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const failReport = {
    ok: false,
    mode: 'db-concurrency-drill',
    stampedAt: new Date().toISOString(),
    error: message,
    note: 'Drill did not complete — GAP #2 (DB race) remains open until ok:true is archived.',
  };
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, `db-concurrency-${stamp}.json`), `${JSON.stringify(failReport, null, 2)}\n`);
    const evidenceDir = resolve(process.cwd(), 'docs/architecture/ops-evidence');
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(resolve(evidenceDir, 'db-concurrency-latest.json'), `${JSON.stringify(failReport, null, 2)}\n`);
  } catch {
    /* ignore */
  }
  console.error(message);
  console.log(JSON.stringify(failReport, null, 2));
  process.exit(1);
});
