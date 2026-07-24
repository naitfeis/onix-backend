/**
 * Backup / restore drill for PostgreSQL + Neon.
 *
 * Modes:
 *   check              — tools + URL presence
 *   diagnose           — dump TOC + source/target summary (no restore)
 *   diagnose-target    — target readiness (no restore)
 *   diagnose-restore   — same as diagnose-target (alias; never runs pg_restore)
 *   backup             — pg_dump from DATABASE_URL only
 *   restore-dry-run    — dump TOC list only
 *   verify             — pg_restore into RESTORE_DATABASE_URL only + schema/data checks
 *
 * Separation:
 *   DATABASE_URL          = dump source (may be pooler or direct)
 *   RESTORE_DATABASE_URL  = restore target (must be direct; never production)
 *
 * Neon: do NOT invent a direct URL by stripping "-pooler". Set a real scratch
 * direct connection string from the Neon console / branch.
 *
 * Usage (PowerShell):
 *   npm run ops:backup-drill -- diagnose
 *   npm run ops:backup-drill -- diagnose-restore
 *   $env:RESTORE_DATABASE_URL = "<direct scratch URL>"
 *   npm run ops:backup-drill -- verify
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lookup as dnsLookup } from 'node:dns/promises';
import { loadEnvFiles } from '../src/env';
import { parsePgRestoreList, type DumpTocInfo } from './backup-restore-toc';

const preDotenv = {
  RESTORE_DATABASE_URL: Boolean((process.env.RESTORE_DATABASE_URL ?? '').trim()),
  DATABASE_URL: Boolean((process.env.DATABASE_URL ?? '').trim()),
};

const envFileLoaded = loadEnvFiles();

const mode = process.argv[2] ?? 'check';
const outDir = resolve(process.cwd(), 'ops-drills');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dumpPath = resolve(outDir, `onix-drill-${stamp}.dump`);

const EXPECTED_RELATIONS = ['User', 'Order', 'Product', '_prisma_migrations'] as const;
const CORE_TABLES = [
  'User', 'LedgerEntry', 'DepositLedgerEntry', 'DepositLock',
  'Order', 'OrderClawback', 'PaymentIntent', 'AuditLog', 'IdempotencyRecord',
] as const;

type UrlDiag = {
  variable: string;
  configured: boolean;
  host: string | null;
  database: string | null;
  user: string | null;
  hasPassword: boolean;
  protocol: string | null;
  isPlaceholder: boolean;
  isPooler: boolean;
  parseError?: string;
};

type RestoreResult = {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  errorLines: string[];
  warningLines: string[];
};

function which(bin: string): boolean {
  return resolvePgBin(bin as 'pg_restore' | 'pg_dump') !== null
    || spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;
}

function resolvePgBin(bin: 'pg_restore' | 'pg_dump'): string | null {
  const viaPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (viaPath.status === 0) {
    const first = (viaPath.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (first && existsSync(first)) return first;
  }
  if (process.platform === 'win32') {
    const roots = [
      process.env['ProgramFiles'],
      process.env['ProgramFiles(x86)'],
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ].filter(Boolean) as string[];
    for (const root of roots) {
      try {
        const pgRoot = resolve(root, 'PostgreSQL');
        if (!existsSync(pgRoot)) continue;
        for (const ver of readdirSync(pgRoot).sort().reverse()) {
          const candidate = resolve(pgRoot, ver, 'bin', `${bin}.exe`);
          if (existsSync(candidate)) return candidate;
        }
      } catch { /* ignore */ }
    }
  }
  return null;
}

function fail(error: string, extra: Record<string, unknown> = {}): never {
  console.error(JSON.stringify({ ok: false, error, ...extra }, null, 2));
  process.exit(1);
}

function redactSecrets(text: string, connectionString?: string): string {
  let out = text;
  if (connectionString) {
    out = out.split(connectionString).join('[RESTORE_DATABASE_URL]');
    try {
      const u = new URL(connectionString);
      if (u.password) {
        out = out.split(decodeURIComponent(u.password)).join('[REDACTED]');
        out = out.split(u.password).join('[REDACTED]');
      }
    } catch { /* ignore */ }
  }
  out = out.replace(/postgresql:\/\/[^:\s]+:[^@\s]+@/gi, 'postgresql://[user]:[REDACTED]@');
  out = out.replace(/postgres:\/\/[^:\s]+:[^@\s]+@/gi, 'postgres://[user]:[REDACTED]@');
  return out;
}

function isPoolerHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return /-pooler\./i.test(host) || /(^|\.)pooler\./i.test(host);
}

function isPlaceholderUrl(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true;
  if (v === 'postgresql://...' || v === 'postgres://...') return true;
  if (/^postgres(ql)?:\/\/\.\.\./i.test(v)) return true;
  if (v.includes('://...')) return true;
  if (/\.\.\./.test(v) && !/@[^/]*[a-z0-9.-]+\.[a-z]{2,}/i.test(v)) return true;
  try {
    const u = new URL(v);
    const host = u.hostname.trim();
    if (!host || host === '...' || host === 'localhost.example' || host === 'example.com') return true;
    if (host.includes('...')) return true;
  } catch {
    return true;
  }
  return false;
}

function diagnoseUrl(variable: string, raw: string | undefined): UrlDiag {
  const value = (raw ?? '').trim();
  if (!value) {
    return {
      variable, configured: false, host: null, database: null, user: null,
      hasPassword: false, protocol: null, isPlaceholder: true, isPooler: false,
    };
  }
  try {
    const u = new URL(value);
    const protocol = u.protocol.replace(/:$/, '');
    const host = u.hostname || null;
    return {
      variable,
      configured: true,
      host,
      database: u.pathname && u.pathname !== '/' ? u.pathname.replace(/^\//, '') : null,
      user: u.username ? decodeURIComponent(u.username) : null,
      hasPassword: Boolean(u.password),
      protocol,
      isPlaceholder: isPlaceholderUrl(value),
      isPooler: isPoolerHost(host),
    };
  } catch (err) {
    return {
      variable, configured: true, host: null, database: null, user: null,
      hasPassword: false, protocol: null, isPlaceholder: true, isPooler: false,
      parseError: err instanceof Error ? err.message : 'invalid URL',
    };
  }
}

function requireValidDatabaseUrl(
  name: 'DATABASE_URL' | 'RESTORE_DATABASE_URL',
  opts?: { role: 'backup-source' | 'restore-target' },
): string {
  const raw = (process.env[name] ?? '').trim();
  const diag = diagnoseUrl(name, raw);

  if (!raw || diag.isPlaceholder) {
    fail(`${name} is missing or contains a placeholder.`, {
      hint: name === 'RESTORE_DATABASE_URL'
        ? 'Set RESTORE_DATABASE_URL to a real scratch PostgreSQL direct connection string.'
        : 'Set DATABASE_URL to a real PostgreSQL connection string.',
      diagnose: diag,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${name} is not a valid URL.`, { diagnose: diag });
  }

  const protocol = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (protocol !== 'postgresql' && protocol !== 'postgres') {
    fail(`${name} must use postgresql: or postgres: protocol.`, { diagnose: { ...diag, protocol } });
  }
  if (!parsed.hostname?.trim()) {
    fail(`${name} has an empty hostname.`, { diagnose: diag });
  }

  if (opts?.role === 'restore-target') {
    const primary = (process.env.DATABASE_URL ?? '').trim();
    if (primary && raw === primary && (process.env.ALLOW_SAME_DB_RESTORE ?? '') !== 'true') {
      fail('RESTORE_DATABASE_URL equals DATABASE_URL — refusing destructive restore.', {
        hint: 'Use a separate Neon branch / scratch database with a direct endpoint.',
        restore: diagnoseUrl('RESTORE_DATABASE_URL', raw),
        primary: diagnoseUrl('DATABASE_URL', primary),
      });
    }
  }

  return raw;
}

function assertNotProd(url: string, label: string): void {
  const lower = url.toLowerCase();
  const blocked = ['onixtg', 'prod', 'production', 'render.com'].some((s) => lower.includes(s));
  const force = (process.env.ALLOW_PROD_BACKUP_DRILL ?? '').toLowerCase() === 'true';
  if (blocked && !force) {
    fail(`${label} looks like production — refusing.`, {
      diagnose: diagnoseUrl(label, url),
      hint: 'Use a dedicated scratch Neon branch. Set ALLOW_PROD_BACKUP_DRILL=true only for explicit backup-from-prod drills (never restore-to-prod).',
    });
  }
}

/** Candidate host for DNS probe only — NEVER used as a connection string. */
function candidateDirectHostFromPooler(host: string): string | null {
  if (!/-pooler\./i.test(host)) return null;
  return host.replace(/-pooler\./i, '.');
}

async function dnsProbe(host: string): Promise<{ ok: boolean; address?: string; error?: string }> {
  try {
    const address = await dnsLookup(host);
    return { ok: true, address: typeof address === 'string' ? address : address.address };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'dns lookup failed' };
  }
}

async function pgConnectProbe(connectionString: string): Promise<{
  ok: boolean;
  database?: string;
  user?: string;
  error?: string;
}> {
  const { Client } = await import('pg');
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 8_000,
    ssl: connectionString.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const r = await client.query<{ db: string; usr: string }>(
      'SELECT current_database() AS db, current_user AS usr',
    );
    return { ok: true, database: r.rows[0]?.db, user: r.rows[0]?.usr };
  } catch (err) {
    return {
      ok: false,
      error: redactSecrets(err instanceof Error ? err.message : 'connection failed', connectionString),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

function latestDump(): string | undefined {
  const forced = process.env.DRILL_DUMP_PATH?.trim();
  if (forced) return forced;
  if (!existsSync(outDir)) return undefined;
  return readdirSync(outDir)
    .filter((f) => f.endsWith('.dump'))
    .sort()
    .map((f) => resolve(outDir, f))
    .at(-1);
}

function inspectDump(dump: string): DumpTocInfo {
  const bin = resolvePgBin('pg_restore');
  if (!bin) {
    fail('pg_restore not found in PATH (or PostgreSQL bin). Install client tools to list dump TOC.');
  }
  const r = spawnSync(bin, ['--list', dump], { encoding: 'utf8' });
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (r.status !== 0) {
    fail('pg_restore --list failed — dump may be corrupt or not custom-format.', {
      exitCode: r.status,
      stderr: redactSecrets(r.stderr ?? '').slice(0, 2000),
      pgRestore: bin,
    });
  }
  return parsePgRestoreList(text);
}

function tryInspectDump(dump: string | undefined): {
  dumpInfo: DumpTocInfo | null;
  listError: string | null;
} {
  if (!dump || !existsSync(dump)) {
    return { dumpInfo: null, listError: dump ? 'dump path does not exist' : 'no dump found' };
  }
  if (!resolvePgBin('pg_restore')) {
    return { dumpInfo: null, listError: 'pg_restore not in PATH — cannot list dump TOC' };
  }
  try {
    return { dumpInfo: inspectDump(dump), listError: null };
  } catch (err) {
    return { dumpInfo: null, listError: err instanceof Error ? err.message : 'pg_restore --list failed' };
  }
}

/**
 * Non-destructive target + dump readiness check.
 * Never runs pg_restore. Never invents connection strings.
 */
async function diagnoseTarget(opts: { modeName: 'diagnose-target' | 'diagnose-restore' }): Promise<void> {
  const dump = latestDump();
  const primary = diagnoseUrl('DATABASE_URL', process.env.DATABASE_URL);
  const restoreRaw = (process.env.RESTORE_DATABASE_URL ?? '').trim();
  const restore = diagnoseUrl('RESTORE_DATABASE_URL', restoreRaw);

  const sameTarget = Boolean(
    restoreRaw
    && (process.env.DATABASE_URL ?? '').trim()
    && restoreRaw === (process.env.DATABASE_URL ?? '').trim(),
  );

  const { dumpInfo, listError } = tryInspectDump(dump);
  const dumpOk = Boolean(dumpInfo?.ok);

  let hostDns: Awaited<ReturnType<typeof dnsProbe>> | null = null;
  let candidateHost: string | null = null;
  let candidateDns: Awaited<ReturnType<typeof dnsProbe>> | null = null;
  if (restore.host) {
    hostDns = await dnsProbe(restore.host);
    if (restore.isPooler) {
      candidateHost = candidateDirectHostFromPooler(restore.host);
      if (candidateHost) candidateDns = await dnsProbe(candidateHost);
    }
  }

  // Connectivity probe only when URL is configured and not a placeholder.
  // For pooler we still probe (proves credentials/DNS) but restore remains blocked.
  let connectivity: Awaited<ReturnType<typeof pgConnectProbe>> | null = null;
  if (restore.configured && !restore.isPlaceholder && restoreRaw) {
    connectivity = await pgConnectProbe(restoreRaw);
  }

  const blockReasons: string[] = [];
  if (!restore.configured || restore.isPlaceholder) {
    blockReasons.push('RESTORE_DATABASE_URL missing or placeholder');
  }
  if (restore.parseError) blockReasons.push(`invalid URL: ${restore.parseError}`);
  if (sameTarget) blockReasons.push('RESTORE_DATABASE_URL equals DATABASE_URL (refusing restore-to-source)');
  if (restore.isPooler) {
    blockReasons.push('RESTORE_DATABASE_URL host is a Neon pooler — pg_restore requires a direct endpoint');
  }
  if (!dumpOk) blockReasons.push(listError ?? 'dump TOC missing required tables');
  if (connectivity && !connectivity.ok && !restore.isPooler) {
    blockReasons.push(`target connection failed: ${connectivity.error ?? 'unknown'}`);
  }

  const readyForRestore = blockReasons.length === 0;
  const instruction = restore.isPooler
    ? {
      problem: 'Restore target is a Neon pooler host',
      poolerHost: restore.host,
      dumpOk,
      restoreBlocked: true,
      doNot: [
        'Do not set ALLOW_POOLER_RESTORE=true as the fix',
        'Do not strip "-pooler" from the hostname and assume it works',
        'Do not point RESTORE_DATABASE_URL at DATABASE_URL / production',
      ],
      do: [
        'In Neon console open (or create) a separate scratch branch/database',
        'Copy the Direct connection string (host must NOT contain "-pooler")',
        'Set RESTORE_DATABASE_URL to that direct URL (sslmode=require)',
        'Re-run: npm run ops:backup-drill -- diagnose-restore',
        'Then: npm run ops:backup-drill -- verify',
      ],
      candidateDirectHostDnsProbeOnly: candidateHost
        ? {
          host: candidateHost,
          dns: candidateDns,
          note: 'DNS probe only — this host was NOT used as a connection string and may not be a valid Neon endpoint for this project.',
        }
        : null,
    }
    : null;

  const report = {
    ok: readyForRestore,
    mode: opts.modeName,
    restorePerformed: false,
    dump: {
      path: dump ?? null,
      dumpOk,
      requiredTablesPresent: dumpInfo
        ? {
          User: dumpInfo.hasUser,
          Order: dumpInfo.hasOrder,
          Product: dumpInfo.hasProduct,
          _prisma_migrations: dumpInfo.hasPrismaMigrations,
        }
        : null,
      tableCount: dumpInfo?.tableCount ?? null,
      listError,
    },
    target: {
      ...restore,
      sameTarget,
      hostDns,
      connectivity: connectivity
        ? { ok: connectivity.ok, database: connectivity.database, user: connectivity.user, error: connectivity.error }
        : null,
      looksLikeProduction: Boolean(
        restore.host
        && ['onixtg', 'prod', 'production', 'render.com'].some((s) => restore.host!.toLowerCase().includes(s)),
      ),
    },
    source: {
      variable: 'DATABASE_URL',
      host: primary.host,
      database: primary.database,
      user: primary.user,
      isPooler: primary.isPooler,
      note: 'Used only as pg_dump source — never as pg_restore target',
    },
    blockReasons,
    instruction,
    sslNote: 'Keep sslmode=require for Neon. verify-full is not auto-applied.',
  };

  console.log(JSON.stringify(report, null, 2));
  if (!readyForRestore) process.exitCode = 1;
}

function runPgRestore(scratch: string, dump: string, verbose: boolean): RestoreResult {
  const bin = resolvePgBin('pg_restore');
  if (!bin) fail('pg_restore not found in PATH');

  const args = [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-acl',
    '--exit-on-error',
    ...(verbose || (process.env.DRILL_RESTORE_VERBOSE ?? '').toLowerCase() === 'true' ? ['--verbose'] : []),
    `--dbname=${scratch}`,
    dump,
  ];

  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const stdout = redactSecrets(r.stdout ?? '', scratch);
  const stderr = redactSecrets(r.stderr ?? '', scratch);
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errorLines = lines.filter((l) => /^pg_restore:\s*error:/i.test(l) || /\bERROR:\b/.test(l));
  const warningLines = lines.filter((l) =>
    /^pg_restore:\s*warning:/i.test(l) || /\bWARNING:\b/i.test(l) || /sslmode/i.test(l),
  );

  return {
    exitCode: r.status,
    signal: r.signal,
    stdout,
    stderr,
    errorLines,
    warningLines: warningLines.slice(0, 30),
  };
}

async function connectScratch(scratch: string) {
  const { Client } = await import('pg');
  const client = new Client({
    connectionString: scratch,
    ssl: scratch.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  const who = await client.query<{ db: string; usr: string; addr: string | null }>(
    `SELECT current_database() AS db, current_user AS usr, inet_server_addr()::text AS addr`,
  );
  return { client, session: who.rows[0]! };
}

async function assertRelationsExist(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  targetDiag: UrlDiag,
): Promise<void> {
  const missing: string[] = [];
  const present: Record<string, string | null> = {};
  for (const name of EXPECTED_RELATIONS) {
    const regName = name.startsWith('_') ? `public.${name}` : `public."${name}"`;
    const res = await client.query('SELECT to_regclass($1)::text AS reg', [regName]);
    const reg = (res.rows[0]?.reg as string | null) ?? null;
    present[name] = reg;
    if (!reg) missing.push(regName);
  }
  if (missing.length) {
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name LIMIT 200
    `);
    fail(`restore completed but expected relation ${missing[0]} is missing`, {
      missing,
      present,
      publicTables: tables.rows.map((r) => r.table_name),
      target: targetDiag,
    });
  }
}

async function runDataIntegrityChecks(
  client: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> },
): Promise<Record<string, unknown>> {
  const checks: Record<string, unknown> = {};
  const core = await client.query(`
    SELECT COUNT(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN
    ('User','LedgerEntry','DepositLedgerEntry','DepositLock','Order','PaymentIntent','AuditLog','IdempotencyRecord')
  `);
  checks.coreTablesPresent = Number(core.rows[0]?.n) === CORE_TABLES.length;

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
  return checks;
}

/** Guard rails before any pg_restore — never falls back to DATABASE_URL. */
async function assertRestoreTargetReady(scratch: string): Promise<UrlDiag> {
  assertNotProd(scratch, 'RESTORE_DATABASE_URL');
  const targetDiag = diagnoseUrl('RESTORE_DATABASE_URL', scratch);

  if (targetDiag.isPooler) {
    const allow = (process.env.ALLOW_POOLER_RESTORE ?? '').toLowerCase() === 'true';
    // Emergency escape hatch only — not the recommended fix.
    if (!allow) {
      fail('Refusing pg_restore via pooler host', {
        reason: 'pooler_target',
        host: targetDiag.host,
        dumpNote: 'Dump may be valid; restore is blocked solely because the target is a pooler.',
        action: [
          'Create or open a Neon scratch branch',
          'Copy its Direct connection string (host without "-pooler")',
          'Set RESTORE_DATABASE_URL to that URL',
          'Do not use DATABASE_URL as the restore target',
        ],
      });
    }
  }

  const probe = await pgConnectProbe(scratch);
  if (!probe.ok) {
    fail('RESTORE_DATABASE_URL is not reachable before pg_restore', {
      target: targetDiag,
      error: probe.error,
    });
  }

  return targetDiag;
}

async function verify(): Promise<void> {
  const dump = latestDump();
  if (!dump || !existsSync(dump)) {
    fail('No dump found. Run backup first or set DRILL_DUMP_PATH.');
  }

  const scratch = requireValidDatabaseUrl('RESTORE_DATABASE_URL', { role: 'restore-target' });
  const targetDiag = await assertRestoreTargetReady(scratch);

  const dumpInfo = inspectDump(dump);
  console.log(JSON.stringify({
    msg: 'verify starting',
    dump,
    dumpInfo,
    target: targetDiag,
    note: 'pg_restore --dbname and pg.Client use RESTORE_DATABASE_URL only — never DATABASE_URL',
  }));

  if (!dumpInfo.ok) {
    fail('Dump TOC missing required tables — aborting before pg_restore.', { dump, dumpInfo });
  }

  const restore = runPgRestore(scratch, dump, false);
  console.log(JSON.stringify({
    msg: 'pg_restore finished',
    exitCode: restore.exitCode,
    errorCount: restore.errorLines.length,
    errorLines: restore.errorLines.slice(0, 40),
    warningLines: restore.warningLines.slice(0, 15),
    stderrTail: restore.stderr.trim().split(/\r?\n/).slice(-40),
    target: targetDiag,
  }, null, 2));

  if (restore.exitCode !== 0 || restore.errorLines.length > 0) {
    fail('pg_restore failed or reported errors — not running data checks.', {
      exitCode: restore.exitCode,
      errorLines: restore.errorLines.slice(0, 50),
      target: targetDiag,
    });
  }

  const { client, session } = await connectScratch(scratch);
  try {
    if (targetDiag.database && session.db !== targetDiag.database) {
      fail('pg Client connected to a different database name than RESTORE_DATABASE_URL.', {
        sessionDb: session.db,
        urlDatabase: targetDiag.database,
      });
    }

    await assertRelationsExist(client, targetDiag);
    const checks = await runDataIntegrityChecks(client);
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

    console.log(JSON.stringify({
      ok,
      mode: 'verify',
      dump,
      target: targetDiag,
      checks,
      rpoMinutes: 5,
      rtoMinutes: 30,
    }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

function diagnose(): void {
  const restore = diagnoseUrl('RESTORE_DATABASE_URL', process.env.RESTORE_DATABASE_URL);
  const primary = diagnoseUrl('DATABASE_URL', process.env.DATABASE_URL);
  const dump = latestDump();
  const { dumpInfo, listError } = tryInspectDump(dump);
  const dumpOk = Boolean(dumpInfo?.ok);
  const urlsOk = restore.configured && !restore.isPlaceholder && primary.configured && !primary.isPlaceholder;

  // diagnose: URLs + dump TOC. Pooler restore target is OK here (reported, not blocked).
  const report = {
    ok: urlsOk && dumpOk,
    mode: 'diagnose',
    dumpValidation: {
      dumpPath: dump ?? null,
      requiredTablesPresent: dumpInfo
        ? {
          User: dumpInfo.hasUser,
          Order: dumpInfo.hasOrder,
          Product: dumpInfo.hasProduct,
          _prisma_migrations: dumpInfo.hasPrismaMigrations,
        }
        : null,
      dumpOk,
      targetIsPooler: restore.isPooler,
      targetIsDirect: restore.configured && !restore.isPooler,
      preferDirectHostForRestore: restore.isPooler,
      listError,
      note: 'No restore performed. Use diagnose-restore for target readiness. verify performs restore.',
    },
    envLoad: {
      note: 'loadEnvFiles uses dotenv override:false — shell env wins over .env',
      cwd: process.cwd(),
      envFileLoaded: envFileLoaded ?? null,
      setInShellBeforeDotenv: preDotenv,
    },
    RESTORE_DATABASE_URL: restore,
    DATABASE_URL: primary,
    sameTarget: Boolean(
      (process.env.RESTORE_DATABASE_URL ?? '').trim()
      && (process.env.DATABASE_URL ?? '').trim()
      && (process.env.RESTORE_DATABASE_URL ?? '').trim() === (process.env.DATABASE_URL ?? '').trim(),
    ),
    tools: {
      pg_dump: which('pg_dump'),
      pg_restore: which('pg_restore'),
      pg_dump_bin: resolvePgBin('pg_dump'),
      pg_restore_bin: resolvePgBin('pg_restore'),
    },
    latestDump: dump ?? null,
    dumpInfo,
    sslNote: 'Prefer sslmode=require for Neon. Auto verify-full is not applied.',
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

function check(): void {
  const hasDump = which('pg_dump');
  const hasRestore = which('pg_restore');
  const primary = diagnoseUrl('DATABASE_URL', process.env.DATABASE_URL);
  const restore = diagnoseUrl('RESTORE_DATABASE_URL', process.env.RESTORE_DATABASE_URL);
  console.log(JSON.stringify({
    ok: hasDump && hasRestore && primary.configured && !primary.isPlaceholder,
    pg_dump: hasDump,
    pg_restore: hasRestore,
    DATABASE_URL: { configured: primary.configured, host: primary.host, isPooler: primary.isPooler },
    RESTORE_DATABASE_URL: {
      configured: restore.configured,
      host: restore.host,
      isPlaceholder: restore.isPlaceholder,
      isPooler: restore.isPooler,
    },
    mode: 'check',
  }, null, 2));
  if (!hasDump || !hasRestore || !primary.configured || primary.isPlaceholder) process.exitCode = 1;
}

function backup(): void {
  const db = requireValidDatabaseUrl('DATABASE_URL', { role: 'backup-source' });
  assertNotProd(db, 'DATABASE_URL');
  const bin = resolvePgBin('pg_dump');
  if (!bin) fail('pg_dump not found in PATH');
  mkdirSync(outDir, { recursive: true });
  execFileSync(bin, [
    '--format=custom',
    '--no-owner',
    '--no-acl',
    `--file=${dumpPath}`,
    db,
  ], { stdio: 'inherit' });
  console.log(JSON.stringify({
    ok: true,
    mode: 'backup',
    dumpPath,
    createdAt: new Date().toISOString(),
    source: diagnoseUrl('DATABASE_URL', db),
  }, null, 2));
  writeFileSync(`${dumpPath}.json`, JSON.stringify({
    ok: true, mode: 'backup', dumpPath, createdAt: new Date().toISOString(),
  }, null, 2));
}

function restoreDryRun(): void {
  const dump = latestDump();
  if (!dump || !existsSync(dump)) fail('No dump found. Run backup first or set DRILL_DUMP_PATH.');
  const scratch = requireValidDatabaseUrl('RESTORE_DATABASE_URL', { role: 'restore-target' });
  assertNotProd(scratch, 'RESTORE_DATABASE_URL');
  const dumpInfo = inspectDump(dump);
  console.log(JSON.stringify({
    ok: dumpInfo.ok,
    mode: 'restore-dry-run',
    dump,
    dumpInfo,
    target: diagnoseUrl('RESTORE_DATABASE_URL', scratch),
    note: 'TOC list only — no data written.',
  }, null, 2));
  if (!dumpInfo.ok) process.exitCode = 1;
}

if (mode === 'check') check();
else if (mode === 'diagnose') diagnose();
else if (mode === 'diagnose-target' || mode === 'diagnose-restore') {
  void diagnoseTarget({ modeName: mode });
} else if (mode === 'backup') backup();
else if (mode === 'restore-dry-run') restoreDryRun();
else if (mode === 'verify') void verify();
else {
  fail(`unknown mode ${mode}`, {
    modes: ['check', 'diagnose', 'diagnose-target', 'diagnose-restore', 'backup', 'restore-dry-run', 'verify'],
  });
}
