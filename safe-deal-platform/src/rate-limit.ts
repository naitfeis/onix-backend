import { HttpException, HttpStatus } from '@nestjs/common';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Simple in-process sliding window. Enough for single-node Stage 1.
 * key e.g. `chat-send:${userId}`
 */
export function assertRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  cur.count += 1;
  if (cur.count > limit) {
    const retrySec = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
    throw new HttpException(
      { message: `Слишком много запросов. Подождите ${retrySec} с.`, retryAfterSec: retrySec },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** Periodic cleanup to avoid unbounded Map growth. */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (now >= v.resetAt) buckets.delete(k);
  }
}, 60_000).unref?.();
