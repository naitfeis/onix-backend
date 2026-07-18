import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { structuredLog } from '../observability/structured-logger';
import { MetricsService } from '../observability/metrics.service';

export type IdempotentResult<T> =
  | { kind: 'replay'; value: T }
  | { kind: 'fresh'; value: T };

/** responseCode conventions on existing IdempotencyRecord: null=IN_PROGRESS, 200=COMPLETED, 0=FAILED */
const CODE_DONE = 200;
const CODE_FAIL = 0;

function hashPayload(payload: unknown): string {
  const json = JSON.stringify(payload ?? null, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return createHash('sha256').update(json).digest('hex');
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Date) return v.toISOString();
    return v;
  })) as Prisma.InputJsonValue;
}

/**
 * Generic idempotency for external side-effects (PSP webhooks, payouts, Telegram callbacks).
 * Uses existing IdempotencyRecord (unique key+route). scope maps to `route`.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async run<T>(
    scope: string,
    key: string,
    requestPayload: unknown,
    execute: () => Promise<T>,
    opts?: { ttlMs?: number; userId?: bigint },
  ): Promise<IdempotentResult<T>> {
    const requestHash = hashPayload(requestPayload);
    const ttlMs = opts?.ttlMs ?? Number(process.env.IDEMPOTENCY_TTL_MS ?? 24 * 60 * 60 * 1000);
    const expiresAt = new Date(Date.now() + (Number.isFinite(ttlMs) ? ttlMs : 24 * 60 * 60 * 1000));
    // PostgreSQL truth: UNIQUE(key, route). When userId is set, namespace key so the
    // effective uniqueness is userId + operation_type(route) + idempotency_key.
    const route = scope.slice(0, 191);
    const rawKey = key.slice(0, 128);
    const idKey = opts?.userId
      ? `${opts.userId.toString()}:${rawKey}`.slice(0, 128)
      : rawKey;

    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          key: idKey,
          route,
          requestHash,
          userId: opts?.userId,
          expiresAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.idempotencyRecord.findUnique({
          where: { key_route: { key: idKey, route } },
        });
        if (!existing) throw err;
        if (existing.requestHash !== requestHash) {
          this.metrics.inc('onix_idempotency_total', { scope: route, result: 'conflict' });
          throw new ConflictException('Ключ идемпотентности уже использован с другим телом запроса.');
        }
        if (existing.responseCode === CODE_DONE && existing.responseBody !== null) {
          this.metrics.inc('onix_idempotency_total', { scope: route, result: 'replay' });
          return { kind: 'replay', value: existing.responseBody as T };
        }
        if (existing.responseCode === null) {
          this.metrics.inc('onix_idempotency_total', { scope: route, result: 'in_progress' });
          throw new ConflictException('Операция с этим ключом ещё выполняется. Повторите позже.');
        }
        // FAILED — allow retry by resetting.
        await this.prisma.idempotencyRecord.update({
          where: { id: existing.id },
          data: {
            responseCode: null,
            responseBody: Prisma.DbNull,
            expiresAt,
            requestHash,
            userId: opts?.userId,
          },
        });
      } else {
        throw err;
      }
    }

    try {
      const value = await execute();
      const stored = toJsonValue(value);
      await this.prisma.idempotencyRecord.update({
        where: { key_route: { key: idKey, route } },
        data: {
          responseCode: CODE_DONE,
          responseBody: stored,
        },
      });
      this.metrics.inc('onix_idempotency_total', { scope: route, result: 'fresh' });
      return { kind: 'fresh', value: stored as T };
    } catch (err) {
      await this.prisma.idempotencyRecord.update({
        where: { key_route: { key: idKey, route } },
        data: {
          responseCode: CODE_FAIL,
          responseBody: Prisma.DbNull,
        },
      }).catch((updateErr) => {
        structuredLog.warn('idempotency fail-mark failed', { scope: route, key: idKey }, updateErr);
      });
      this.metrics.inc('onix_idempotency_total', { scope: route, result: 'failed' });
      throw err;
    }
  }

  /** Purge expired rows — called by worker. */
  async purgeExpired(limit = 500): Promise<number> {
    const due = await this.prisma.idempotencyRecord.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { id: true },
      take: limit,
    });
    if (!due.length) return 0;
    const result = await this.prisma.idempotencyRecord.deleteMany({
      where: { id: { in: due.map((r) => r.id) } },
    });
    return result.count;
  }
}
