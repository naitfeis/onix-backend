import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma.service';

const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);
/** pg driver adapter marks a serialization/deadlock failure with this kind. */
const RETRYABLE_CONFLICT_KINDS = new Set(['TransactionWriteConflict']);
/**
 * Prisma wraps driver errors: `P2010` (raw query failed) carries the real SQL state
 * in `meta.driverAdapterError.cause.originalCode`, not in `code` or `meta.code`.
 * Only walking the wrapper let every conflict inside `$queryRaw` escape the retry
 * loop and surface as a 500 — which is exactly where `SELECT ... FOR UPDATE` lives.
 */
const MAX_CAUSE_DEPTH = 8;

export function isRetryableTransactionConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;
  while (current && typeof current === 'object' && !seen.has(current) && depth < MAX_CAUSE_DEPTH) {
    seen.add(current);
    depth += 1;
    const value = current as {
      code?: unknown;
      meta?: unknown;
      cause?: unknown;
    };
    if (value.code === 'P2034' || RETRYABLE_SQLSTATES.has(String(value.code))) return true;
    if (isRetryableMeta(value.meta, seen)) return true;
    current = value.cause;
  }
  return false;
}

/** Recursively scan a Prisma `meta` payload for a retryable SQL state or kind. */
function isRetryableMeta(meta: unknown, seen: Set<unknown>, depth = 0): boolean {
  if (!meta || typeof meta !== 'object' || seen.has(meta) || depth > MAX_CAUSE_DEPTH) return false;
  seen.add(meta);
  const row = meta as Record<string, unknown>;
  for (const key of ['code', 'database_error', 'originalCode']) {
    if (RETRYABLE_SQLSTATES.has(String(row[key]))) return true;
  }
  if (typeof row.kind === 'string' && RETRYABLE_CONFLICT_KINDS.has(row.kind)) return true;
  for (const value of Object.values(row)) {
    if (value && typeof value === 'object' && isRetryableMeta(value, seen, depth + 1)) return true;
  }
  return false;
}

// Prisma's built-in defaults (maxWait=2000ms to acquire a connection/BEGIN, timeout=5000ms
// for the whole interactive transaction) assume a low-latency, co-located database. Against a
// remote serverless Postgres (Neon: pooler cold starts, cross-region round trips, or a burst of
// concurrent requests serializing on the same advisory lock/row) that budget is routinely too
// tight and surfaces as "Transaction API error: Unable to start a transaction in the given
// time." even though nothing is actually deadlocked — only found by testing real concurrency
// against a real network-attached Postgres instead of an in-memory/mocked client.
function maxWaitMs(): number {
  const v = Number(process.env.DB_TX_MAX_WAIT_MS ?? 8_000);
  return Number.isFinite(v) && v > 0 ? v : 8_000;
}

function timeoutMs(): number {
  const v = Number(process.env.DB_TX_TIMEOUT_MS ?? 10_000);
  return Number.isFinite(v) && v > 0 ? v : 10_000;
}

/** Default 5 attempts: the throughput drill showed 10 concurrent completes on one
 * seller exhausting 3 attempts and surfacing TransactionWriteConflict as a 500.
 * Every retry re-runs an idempotency-key guarded callback, so retrying is safe. */
export async function withSerializableTransaction<T>(
  prisma: Pick<PrismaService, '$transaction'>,
  execute: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  const attempts = Math.max(1, Math.min(5, Math.trunc(maxAttempts)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(execute, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: maxWaitMs(),
        timeout: timeoutMs(),
      });
    } catch (error) {
      if (attempt >= attempts || !isRetryableTransactionConflict(error)) throw error;
      // Serialization conflicts (40001) and deadlocks (40P01) need a short jittered pause
      // so the winner can commit before this session retries the whole callback.
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 60)));
    }
  }
}
