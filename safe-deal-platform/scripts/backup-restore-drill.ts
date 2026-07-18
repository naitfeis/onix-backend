/**
 * Backup / restore drill for Neon Postgres (or any DATABASE_URL).
 *
 * Modes:
 *   npm run ops:backup-drill -- check
 *   npm run ops:backup-drill -- backup
 *   npm run ops:backup-drill -- restore-dry-run
 *   npm run ops:backup-drill -- verify   # restore to scratch + integrity checks
 *
 * Never points restore at production. RESTORE_DATABASE_URL must be a scratch DB.
 *
 * Target RPO / RTO (ops policy — Neon PITR):
 *   RPO: ≤ 5 minutes (Neon continuous WAL)
 *   RTO: ≤ 30 minutes (scratch restore + migrate + integrity + cutover decision)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFiles } from '../src/env';

loadEnvFiles();

const mode = process.argv[2] ?? 'check';
const outDir = resolve(process.cwd(), 'ops-drills');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dumpPath = resolve(outDir, `onix-drill-${stamp}.dump`);

function which(bin: string): boolean {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return r.status === 0;
}

function requireDatabaseUrl(name: string): string {
  const url = (process.env[name] ?? '').trim();
  if (!url) {
    console.error(JSON.stringify({ ok: false, error: `${name} is required` }));
    process.exit(1);
  }
  return url;
}

function assertNotProd(url: string, label: string): void {
  const lower = url.toLowerCase();
  const blocked = ['onixtg', 'prod', 'production', 'render.com'].some((s) => lower.includes(s));
  const force = (process.env.ALLOW_PROD_BACKUP_DRILL ?? '').toLowerCase() === 'true';
  if (blocked && !force) {
    console.error(JSON.stringify({
      ok: false,
      error: `${label} looks like production — set ALLOW_PROD_BACKUP_DRILL=true to override (backup only)`,
    }));
    process.exit(1);
  }
}

function latestDump(): string | undefined {
  if (!existsSync(outDir)) return undefined;
  return readdirSync(outDir)
    .filter((f) => f.endsWith('.dump'))
    .sort()
    .map((f) => resolve(outDir, f))
    .at(-1);
}

function check(): void {
  const hasDump = which('pg_dump');
  const hasRestore = which('pg_restore');
  const db = (process.env.DATABASE_URL ?? '').trim();
  console.log(JSON.stringify({
    ok: hasDump && hasRestore && Boolean(db),
    pg_dump: hasDump,
    pg_restore: hasRestore,
    databaseUrlSet: Boolean(db),
    rpoMinutes: 5,
    rtoMinutes: 30,
    mode: 'check',
  }, null, 2));
  if (!hasDump || !hasRestore || !db) process.exitCode = 1;
}

function backup(): void {
  const db = requireDatabaseUrl('DATABASE_URL');
  assertNotProd(db, 'DATABASE_URL');
  if (!which('pg_dump')) {
    console.error(JSON.stringify({ ok: false, error: 'pg_dump not found in PATH' }));
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  execFileSync('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-acl',
    `--file=${dumpPath}`,
    db,
  ], { stdio: 'inherit' });
  const meta = {
    ok: true,
    mode: 'backup',
    dumpPath,
    createdAt: new Date().toISOString(),
    rpoMinutes: 5,
    rtoMinutes: 30,
  };
  writeFileSync(`${dumpPath}.json`, JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
}

function restoreDryRun(): void {
  const dump = process.env.DRILL_DUMP_PATH?.trim() || latestDump();
  if (!dump || !existsSync(dump)) {
    console.error(JSON.stringify({ ok: false, error: 'No dump found. Run backup first or set DRILL_DUMP_PATH.' }));
    process.exit(1);
  }
  const scratch = requireDatabaseUrl('RESTORE_DATABASE_URL');
  if (scratch === process.env.DATABASE_URL && (process.env.ALLOW_SAME_DB_RESTORE ?? '') !== 'true') {
    console.error(JSON.stringify({ ok: false, error: 'RESTORE_DATABASE_URL equals DATABASE_URL' }));
    process.exit(1);
  }
  assertNotProd(scratch, 'RESTORE_DATABASE_URL');
  if (!which('pg_restore')) {
    console.error(JSON.stringify({ ok: false, error: 'pg_restore not found in PATH' }));
    process.exit(1);
  }
  execFileSync('pg_restore', ['--list', dump], { stdio: 'inherit' });
  console.log(JSON.stringify({
    ok: true,
    mode: 'restore-dry-run',
    dump,
    scratchConfigured: true,
  }, null, 2));
}

/** Full drill: restore into scratch DB, run integrity SQL, optionally drop schema. */
async function verify(): Promise<void> {
  const dump = process.env.DRILL_DUMP_PATH?.trim() || latestDump();
  if (!dump || !existsSync(dump)) {
    console.error(JSON.stringify({ ok: false, error: 'No dump found. Run backup first or set DRILL_DUMP_PATH.' }));
    process.exit(1);
  }
  const scratch = requireDatabaseUrl('RESTORE_DATABASE_URL');
  if (scratch === process.env.DATABASE_URL && (process.env.ALLOW_SAME_DB_RESTORE ?? '') !== 'true') {
    console.error(JSON.stringify({ ok: false, error: 'RESTORE_DATABASE_URL equals DATABASE_URL' }));
    process.exit(1);
  }
  assertNotProd(scratch, 'RESTORE_DATABASE_URL');
  if (!which('pg_restore')) {
    console.error(JSON.stringify({ ok: false, error: 'pg_restore not found in PATH' }));
    process.exit(1);
  }

  execFileSync('pg_restore', [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-acl',
    `--dbname=${scratch}`,
    dump,
  ], { stdio: 'inherit' });

  const { Client } = await import('pg');
  const client = new Client({ connectionString: scratch });
  await client.connect();
  const checks: Record<string, unknown> = {};
  try {
    const tables = await client.query(`
      SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN
      ('User','LedgerEntry','DepositLedgerEntry','DepositLock','Order','PaymentIntent','AuditLog','IdempotencyRecord')
    `);
    checks.coreTablesPresent = tables.rows[0]?.n === 8;

    const negBalances = await client.query(`
      SELECT COUNT(*)::int AS n FROM "User"
      WHERE "balanceCents" < 0 OR "depositAvailableCents" < 0 OR "depositLockedCents" < 0
    `);
    checks.negativeBalances = negBalances.rows[0]?.n ?? -1;

    const lockMismatch = await client.query(`
      SELECT COUNT(*)::int AS n FROM "User" u
      WHERE u."depositLockedCents" <> COALESCE((
        SELECT SUM(d."amountCents") FROM "DepositLock" d
        WHERE d."userId" = u.id AND d.status = 'ACTIVE'
      ), 0)
    `);
    checks.depositLockMismatches = lockMismatch.rows[0]?.n ?? -1;

    const payoutDup = await client.query(`
      SELECT COUNT(*)::int AS n FROM (
        SELECT "orderId" FROM "LedgerEntry"
        WHERE type = 'SALE_PAYOUT' AND "orderId" IS NOT NULL
        GROUP BY "orderId" HAVING COUNT(*) > 1
      ) t
    `);
    checks.duplicatePayouts = payoutDup.rows[0]?.n ?? -1;

    const orderOrphans = await client.query(`
      SELECT COUNT(*)::int AS n FROM "Order" o
      WHERE o.status = 'COMPLETED' AND o."payoutCents" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "LedgerEntry" l
          WHERE l."orderId" = o.id AND l.type = 'SALE_PAYOUT'
        )
    `);
    checks.completedWithoutPayout = orderOrphans.rows[0]?.n ?? -1;

    const ok =
      checks.coreTablesPresent === true
      && checks.negativeBalances === 0
      && checks.depositLockMismatches === 0
      && checks.duplicatePayouts === 0
      && checks.completedWithoutPayout === 0;

    const destroy = (process.env.DRILL_DESTROY_SCRATCH ?? 'true').toLowerCase() !== 'false';
    if (destroy) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      checks.scratchDestroyed = true;
    }

    const report = {
      ok,
      mode: 'verify',
      dump,
      checks,
      rpoMinutes: 5,
      rtoMinutes: 30,
      checked: ['balances', 'ledger', 'escrow_locks', 'deposits', 'orders', 'audit_tables'],
    };
    console.log(JSON.stringify(report, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (mode === 'check') check();
else if (mode === 'backup') backup();
else if (mode === 'restore-dry-run') restoreDryRun();
else if (mode === 'verify') void verify();
else {
  console.error(JSON.stringify({ ok: false, error: `unknown mode ${mode}` }));
  process.exit(1);
}
