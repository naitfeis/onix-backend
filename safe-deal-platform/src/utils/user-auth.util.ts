import { NotFoundException, UnauthorizedException } from '@nestjs/common';

export class UserAuthUtil {
  // ИСПРАВЛЕНИЕ: изменили string на bigint для вашей высоконагруженной схемы
  static async checkUserExists(prisma: any, userId: bigint) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    }).catch(() => {
      throw new NotFoundException('Пользователь не найден в системе');
    });
    return user;
  }

  static async checkTelegramLinked(user: any) {
    if (!user.telegramId) {
      throw new UnauthorizedException(
        'Для выставления товара привяжите аккаунт Telegram в разделе "Настройки".'
      );
    }
  }
}