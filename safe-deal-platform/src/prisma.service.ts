import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static pool: Pool;
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('[FATAL] DATABASE_URL не найден в .env');
    }

    PrismaService.pool = new Pool({
      connectionString,
      max: 10,                  // максимум соединений в пуле
      idleTimeoutMillis: 30000, // закрываем idle-соединения через 30 сек
      connectionTimeoutMillis: 5000,
    });

    const adapter = new PrismaPg(PrismaService.pool);
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('[PRISMA] Подключение к PostgreSQL Neon.tech установлено');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await PrismaService.pool.end();
    this.logger.log('[PRISMA] Соединение с PostgreSQL закрыто');
  }
}