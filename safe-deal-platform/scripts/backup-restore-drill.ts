/**
 * Backup / restore drill for Neon Postgres (or any DATABASE_URL).
 *
 * Modes:
 *   npm run ops:backup-drill -- check     # verify pg_dump/pg_restore + env
 *   npm run ops:backup-drill -- backup    # dump schema+data to ./ops-drills/
 *   npm run ops:backup-drill -- restore-dry-run  # pg_restore --list only
 *
 * Never points restore at production. RESTORE_DATABASE_URL must be a scratch DB.
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
    note: 'To actually restore: pg_restore --clean --if-exists --no-owner --dbname="$RESTORE_DATABASE_URL" dump',
  }, null, 2));
}

if (mode === 'check') check();
else if (mode === 'backup') backup();
else if (mode === 'restore-dry-run') restoreDryRun();
else {
  console.error(JSON.stringify({ ok: false, error: `unknown mode ${mode}` }));
  process.exit(1);
}
