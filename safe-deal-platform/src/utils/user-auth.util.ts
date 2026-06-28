import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export class UserAuthUtil {
  /**
   * Ищет пользователя по внутреннему BigInt id.
   * Бросает 404 если не найден.
   */
  static async checkUserExists(prisma: PrismaService, userId: bigint) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`Пользователь #${userId} не найден в системе`);
    }
    return user;
  }

  /**
   * Ищет пользователя по Telegram ID (telegramId).
   * Используется для авторизации через Telegram Web App.
   */
  static async findByTelegramId(prisma: PrismaService, telegramId: bigint) {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      throw new NotFoundException(`Пользователь с Telegram ID ${telegramId} не найден`);
    }
    return user;
  }

  /**
   * Проверяет что у пользователя привязан Telegram (для выставления лотов).
   */
  static checkTelegramLinked(user: { telegramId: bigint | null }): void {
    if (!user.telegramId) {
      throw new ForbiddenException(
        'Для выставления товара необходимо войти через Telegram Mini App.'
      );
    }
  }
}