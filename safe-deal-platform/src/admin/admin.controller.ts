import { Controller, Post, Delete, Body, Param, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Controller('admin')
export class AdminController {
  constructor(private prisma: PrismaService) {}

  // 👑 Профессиональный щит: читаем ID владельца из системного файла .env
  private getOwnerId(): bigint {
    const envId = process.env.ADMIN_TELEGRAM_ID;
    if (!envId) {
      throw new ForbiddenException('Конфигурация безопасности сервера нарушена.');
    }
    return BigInt(envId);
  }

  // Внутренний метод верификации прав и автоматического логирования действий
  private async verifyAndLog(adminId: string, actionType: string, targetId: string, details: string) {
    if (BigInt(adminId) !== this.getOwnerId()) {
      throw new ForbiddenException('Доступ заблокирован. У вас нет прав Администратора ONIX.');
    }

    // Синьор-требование: пишем каждый шаг админа в историю для полной отчетности CEO
    await this.prisma.$executeRaw`
      INSERT INTO "GlobalChat" (id, "senderId", "senderName", text, "isAdmin", timestamp)
      VALUES (gen_random_uuid()::text, ${BigInt(adminId)}, 'SYSTEM_LOG', ${`[ACTION: ${actionType}] Target: ${targetId}. Details: ${details}`}, true, NOW())
    `;
  }

  // 1. УПРАВЛЕНИЕ БАЛАНСАМИ: Жестко выставить баланс в BigInt-копейках
  @Post('user/balance')
  async changeUserBalance(
    @Body('adminId') adminId: string,
    @Body('targetUserId') targetUserId: string,
    @Body('amountRubles') amountRubles: number
  ) {
    if (amountRubles < 0 || isNaN(amountRubles)) {
      throw new BadRequestException('Сумма баланса не может быть отрицательной');
    }

    const targetBigIntId = BigInt(targetUserId);
    const centsAmount = BigInt(Math.round(amountRubles * 100));

    // Проверяем права и пишем лог изменений
    await this.verifyAndLog(adminId, 'CHANGE_BALANCE', targetUserId, `Установлен баланс: ${amountRubles} руб.`);

    await this.prisma.user.update({
      where: { id: targetBigIntId },
      data: { balanceCents: centsAmount }
    });

    return { success: true, message: `Баланс пользователя успешно изменен на ${amountRubles} руб.` };
  }

  // 2. ЖЕСТКИЙ БАН: Блокировка пользователя через метку в базе Neon
  @Post('user/ban')
  async banUser(
    @Body('adminId') adminId: string,
    @Body('targetUserId') targetUserId: string
  ) {
    const targetBigIntId = BigInt(targetUserId);

    await this.verifyAndLog(adminId, 'BAN_USER', targetUserId, 'Выдан перманентный бан');

    await this.prisma.user.update({
      where: { id: targetBigIntId },
      data: { deletedAt: new Date() }
    });

    return { success: true, message: `Пользователь намертво забанен в ONIX.` };
  }

  // 3. МОДЕРАЦИЯ ВИТРИНЫ: Стереть объявление с маркета в архив
  @Delete('product/:id')
  async deleteProduct(
    @Body('adminId') adminId: string,
    @Param('id') productId: string
  ) {
    await this.verifyAndLog(adminId, 'DELETE_PRODUCT', productId, 'Товар принудительно отправлен в архив');

    await this.prisma.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED' }
    });

    return { success: true, message: `Объявление успешно удалено администратором.` };
  }
}