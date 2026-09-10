import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * Nest-scoped Prisma singleton (provided once via @Global DatabaseModule).
 * Static Pool is created at most once per process — never recreated in constructor.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static pool: Pool | undefined;
  private static connectPromise: Promise<void> | undefined;
  private static poolEndPromise: Promise<void> | undefined;
  private static connectionErrors = 0;
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('[FATAL] DATABASE_URL не найден в .env');
    }

    if (!PrismaService.pool) {
      // Neon / PgBouncer: default 10 leaves headroom for API + worker without saturating.
      PrismaService.pool = new Pool({
        connectionString,
        max: Number(process.env.PG_POOL_MAX ?? 10),
        idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
        connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 5_000),
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
      });
      PrismaService.pool.on('error', () => {
        PrismaService.connectionErrors += 1;
      });
    }

    super({ adapter: new PrismaPg(PrismaService.pool) });
  }

  /** For metrics scrape — no Nest DI coupling. */
  static getPoolStats(): { total: number; idle: number; waiting: number; connectionErrors: number } | null {
    const pool = PrismaService.pool;
    if (!pool) return null;
    return {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      connectionErrors: PrismaService.connectionErrors,
    };
  }

  async onModuleInit(): Promise<void> {
    // Dedupe $connect if Nest ever invokes init more than once.
    if (!PrismaService.connectPromise) {
      PrismaService.connectPromise = this.$connect().then(() => {
        this.logger.log('Prisma connected');
      });
    }
    await PrismaService.connectPromise;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect().catch(() => undefined);
    // Render SIGTERM can invoke destroy hooks more than once — pg Pool.end() is not idempotent.
    if (!PrismaService.pool) {
      if (PrismaService.poolEndPromise) await PrismaService.poolEndPromise;
      return;
    }
    if (!PrismaService.poolEndPromise) {
      const pool = PrismaService.pool;
      PrismaService.pool = undefined;
      PrismaService.connectPromise = undefined;
      PrismaService.poolEndPromise = pool.end().catch(() => undefined).then(() => {
        PrismaService.poolEndPromise = undefined;
      });
    }
    await PrismaService.poolEndPromise;
  }
}
