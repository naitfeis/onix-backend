import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { structuredLog } from '../observability/structured-logger';
import { MetricsService } from '../observability/metrics.service';
import { withSerializableTransaction } from '../database/transaction-retry';

export type IdempotentResult<T> =
  | { kind: 'replay'; value: T }
  | { kind: 'fresh'; value: T };

type RunOptions<T> = {
  ttlMs?: number;
  userId?: bigint;
  /** Optional reconciliation for legacy non-transactional side effects left IN_PROGRESS. */
  recover?: () => Promise<T | undefined>;
};

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
 * Deterministic signed 64-bit advisory-lock id for pg_advisory_xact_lock(bigint).
 *
 * Hashed entirely in JS (never sent to Postgres as a text parameter) so the lock id
 * can never trip PostgreSQL's UTF8 validation — unlike joining route+key with a
 * literal separator character and hashing server-side via hashtextextended(text, ...),
 * which fails with "invalid byte sequence for encoding UTF8: 0x00" the moment any
 * separator collides with byte 0x00, or any route/key legitimately contains one.
 */
function lockIdFor(route: string, idKey: string): bigint {
  const digest = createHash('sha256').update(`${route}\u0001${idKey}`, 'utf8').digest();
  return digest.readBigInt64BE(0);
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
    opts?: RunOptions<T>,
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
          const recovered = await opts?.recover?.();
          if (recovered !== undefined) {
            const stored = toJsonValue(recovered);
            await this.prisma.idempotencyRecord.update({
              where: { id: existing.id },
              data: { responseCode: CODE_DONE, responseBody: stored },
            });
            this.metrics.inc('onix_idempotency_total', { scope: route, result: 'recovered' });
            return { kind: 'replay', value: stored as T };
          }
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

  /**
   * Atomically claims the key, executes a database mutation, and stores its response.
   * A PostgreSQL advisory transaction lock removes the absent-row/P2002 race.
   */
  async runTransactional<T>(
    scope: string,
    key: string,
    requestPayload: unknown,
    execute: (tx: Prisma.TransactionClient) => Promise<T>,
    opts?: Omit<RunOptions<T>, 'recover'>,
  ): Promise<IdempotentResult<T>> {
    const requestHash = hashPayload(requestPayload);
    const ttlMs = opts?.ttlMs ?? Number(process.env.IDEMPOTENCY_TTL_MS ?? 24 * 60 * 60 * 1000);
    const expiresAt = new Date(Date.now() + (Number.isFinite(ttlMs) ? ttlMs : 24 * 60 * 60 * 1000));
    const route = scope.slice(0, 191);
    const rawKey = key.slice(0, 128);
    const idKey = opts?.userId
      ? `${opts.userId.toString()}:${rawKey}`.slice(0, 128)
      : rawKey;
    const lockId = lockIdFor(route, idKey);

    const result = await withSerializableTransaction(this.prisma, async (tx) => {
      // pg_advisory_xact_lock returns void; $executeRaw skips Prisma's row deserialization,
      // which otherwise fails on real Postgres with "Failed to deserialize column of type
      // 'void'" (only surfaced by real-DB tests — in-memory/mocked Prisma never executes this).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;
      const existing = await tx.idempotencyRecord.findUnique({
        where: { key_route: { key: idKey, route } },
      });
      if (existing?.requestHash !== undefined && existing.requestHash !== requestHash) {
        throw new ConflictException('Ключ идемпотентности уже использован с другим телом запроса.');
      }
      if (existing?.responseCode === CODE_DONE && existing.responseBody !== null) {
        return { kind: 'replay' as const, value: existing.responseBody as T };
      }
      if (existing?.responseCode === null) {
        // This can only be a legacy record: transactional claims never survive a crash alone.
        throw new ConflictException('Операция с этим ключом ещё выполняется. Повторите позже.');
      }
      if (existing) {
        await tx.idempotencyRecord.update({
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
        await tx.idempotencyRecord.create({
          data: { key: idKey, route, requestHash, userId: opts?.userId, expiresAt },
        });
      }

      const value = await execute(tx);
      const stored = toJsonValue(value);
      await tx.idempotencyRecord.update({
        where: { key_route: { key: idKey, route } },
        data: { responseCode: CODE_DONE, responseBody: stored },
      });
      return { kind: 'fresh' as const, value: stored as T };
    });

    this.metrics.inc('onix_idempotency_total', { scope: route, result: result.kind });
    return result;
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
