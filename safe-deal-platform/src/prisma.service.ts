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
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('[FATAL] DATABASE_URL не найден в .env');
    }

    if (!PrismaService.pool) {
      // Neon + single Render instance: keep pool small (PgBouncer-friendly).
      PrismaService.pool = new Pool({
        connectionString,
        max: Number(process.env.PG_POOL_MAX ?? 5),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });
    }

    super({ adapter: new PrismaPg(PrismaService.pool) });
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
    await this.$disconnect();
    if (PrismaService.pool) {
      await PrismaService.pool.end();
      PrismaService.pool = undefined;
      PrismaService.connectPromise = undefined;
    }
  }
}
