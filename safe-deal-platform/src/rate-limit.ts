import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { SharedCoordinationService } from './coordination/shared-coordination.service';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function pruneRateLimitBuckets(now: number): void {
  for (const [k, v] of buckets) {
    if (now >= v.resetAt) buckets.delete(k);
  }
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (!oldest) break;
    buckets.delete(oldest);
  }
}

/**
 * Simple in-process sliding window. Enough for single-node Stage 1.
 * key e.g. `chat-send:${userId}`
 */
export function assertRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    if (buckets.size >= MAX_BUCKETS) pruneRateLimitBuckets(now);
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

/** Shared fixed-window limiter for security-sensitive, scale-out request paths. */
@Injectable()
export class DistributedRateLimiter {
  constructor(private readonly coordination: SharedCoordinationService) {}

  async assert(key: string, limit: number, windowMs: number): Promise<void> {
    const result = await this.coordination.consumeFixedWindow(key, limit, windowMs);
    if (result.allowed) return;
    const retrySec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
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
