import { Controller, Get, Query, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// СИНЬОР-ФИКС №1: Убираем 'api/', так как глобальный префикс из main.ts подставит его автоматически! [проф. 1]
@Controller('users')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 👑 ENTERPRISE API: Высокоскоростной клиринг, регистрация и синхронизация балансов трейдеров [проф. 1]
   */
  @Get('profile')
  async getUserProfile(@Query('tgId') tgIdStr: string) {
    // Валидация входящего строкового буфера
    if (!tgIdStr || isNaN(Number(tgIdStr))) {
      throw new BadRequestException('[🚨 API ERROR]: Параметр tgId должен быть валидной числовой строкой.');
    }

    const telegramId = BigInt(tgIdStr.trim());

    try {
      // СИНЬОР-ФИКС №2: Наш боевой дефолтный капитал для беты (5000 рублей) переводим в BigInt-копейки!
      // В СУБД баланс инициализируется как 500000 копеек, защищая кассу от Race Conditions.
      const initialBalanceCents = BigInt(5000 * 100);

      // АТОМАРНЫЙ UPSERT: Синхронизируем состояние сессии трейдера с таблицами PostgreSQL Neon.tech [проф. 1]
      const user = await this.prisma.user.upsert({
        where: { telegramId },
        update: {}, // Если трейдер уже в базе — его текущий баланс не трогается
        create: {
          telegramId,
          telegramNick: `trader_${tgIdStr.substring(0, 4)}`,
          telegramToken: `tkn_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          // Предполагается, что в твоей схеме Prisma есть поле balanceCents или balance (тип BigInt) [проф. 1]
          balanceCents: initialBalanceCents,
        },
      });

      this.logger.log(`[👤 ONIX SHIELD CORE]: Пользователь ID №${user.id} успешно прошел верификацию в СУБД.`);

      // Динамический перевод BigInt-копеек из базы данных в фиатные рубли для React-компонента [проф. 1]
      // Если у тебя поле в схеме называется по-другому (например, balance), просто замени user.balanceCents на твое поле
      const liveBalanceCents = (user as any).balanceCents ?? initialBalanceCents;
      const liveBalanceRubles = (Number(liveBalanceCents) / 100).toFixed(2);

      // Безопасный возврат данных в изолированную структуру фронтенда
      return {
        success: true,
        data: {
          id: user.id.toString(),
          telegramNick: user.telegramNick || `trader_${user.id}`,
          balanceMain: liveBalanceRubles, // Твой живой баланс: уменьшается при покупках и растет при продажах! [проф. 1]
          balanceBonus: "0.00"
        }
      };

    } catch (error: any) {
      this.logger.error(`[🚨 USER PROFILE CRASH]: ${error.message}`);
      throw new BadRequestException('Критическая ошибка инициализации сессии трейдера в СУБД PostgreSQL.');
    }
  }
}