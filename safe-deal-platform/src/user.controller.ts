import { Controller, Get, Query, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('users')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('profile')
  async getUserProfile(@Query('tgId') tgIdStr: string) {
    if (!tgIdStr || isNaN(Number(tgIdStr))) {
      throw new BadRequestException('[🚨 API ERROR]: Параметр tgId должен быть валидной числовой строкой.');
    }

    const telegramId = BigInt(tgIdStr.trim());

    try {
      // Инициализируем демо-капитал: 5000 рублей * 100 = 500000 копеек в BigInt
      const initialBalanceCents = BigInt(5000 * 100);

      // Атомарная синхронизация: Ищем юзера или регистрируем с балансом 5000 рублей
      const user = await this.prisma.user.upsert({
        where: { telegramId },
        update: {},
        create: {
          telegramId,
          telegramNick: `trader_${tgIdStr.substring(0, 4)}`,
          telegramToken: `tkn_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          balanceCents: initialBalanceCents, // Запись в ячейку PostgreSQL
        },
      });

      this.logger.log(`[👤 PROFILE ACCESS]: Трейдер ID №${user.id} успешно верифицирован.`);

      // Переводим BigInt-копейки из базы в рубли для фронтенда
      const liveBalanceRubles = (Number(user.balanceCents) / 100).toFixed(2);

      return {
        success: true,
        data: {
          id: user.id.toString(),
          telegramNick: user.telegramNick || `trader_${user.id}`,
          balanceMain: liveBalanceRubles, // Динамический баланс
          balanceBonus: "0.00"
        }
      };
    } catch (error: any) {
      this.logger.error(`[🚨 USER PROFILE CRASH]: ${error.message}`);
      throw new BadRequestException('Критическая ошибка инициализации сессии трейдера в СУБД.');
    }
  }
}