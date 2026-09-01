import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma.service';

const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

export function isRetryableTransactionConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const value = current as {
      code?: unknown;
      message?: unknown;
      meta?: unknown;
      cause?: unknown;
    };
    if (value.code === 'P2034' || RETRYABLE_SQLSTATES.has(String(value.code))) return true;
    const meta = value.meta as { code?: unknown; database_error?: unknown } | undefined;
    if (meta && (RETRYABLE_SQLSTATES.has(String(meta.code)) || RETRYABLE_SQLSTATES.has(String(meta.database_error)))) {
      return true;
    }
    current = value.cause;
  }
  return false;
}

export async function withSerializableTransaction<T>(
  prisma: Pick<PrismaService, '$transaction'>,
  execute: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  const attempts = Math.max(1, Math.min(5, Math.trunc(maxAttempts)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(execute, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (attempt >= attempts || !isRetryableTransactionConflict(error)) throw error;
      // Serialization conflicts (40001) and deadlocks (40P01) need a short jittered pause
      // so the winner can commit before this session retries the whole callback.
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 60)));
    }
  }
}
