import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Критическая ошибка: DATABASE_URL не найден в .env');
    }

    // 1. Создаем стандартный пул соединений Node-Postgres
    PrismaService.pool = new Pool({ connectionString });

    // 2. Оборачиваем его в официальный адаптер Prisma 7
    const adapter = new PrismaPg(PrismaService.pool);

    // 3. Передаем адаптер в ядро PrismaClient (это полностью решает ошибку инициализации!)
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await PrismaService.pool.end(); // Безопасно закрываем пул драйвера при выключении сайта
  }
}