import {
  Controller, Post, Delete, Body, Param,
  ForbiddenException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

class ApiResponse<T> {
  readonly success = true;
  constructor(public readonly data: T) {}
}

@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(private readonly prisma: PrismaService) {}

  private getOwnerTgId(): bigint {
    const envId = process.env.ADMIN_TELEGRAM_ID;
    if (!envId || !/^\d+$/.test(envId)) {
      throw new ForbiddenException('Конфигурация безопасности сервера нарушена.');
    }
    return BigInt(envId);
  }

  private async verifyAdmin(adminTgId: string, action: string, targetId: string): Promise<void> {
    if (!adminTgId || !/^\d+$/.test(adminTgId.trim())) {
      throw new BadRequestException('adminTgId должен быть числовой строкой.');
    }
    if (BigInt(adminTgId.trim()) !== this.getOwnerTgId()) {
      this.logger.warn(`[ADMIN] Попытка несанкционированного доступа: tgId=${adminTgId}`);
      throw new ForbiddenException('Нет прав администратора ONIX.');
    }
    // Записываем каждое действие в лог чата
    await this.prisma.globalChat.create({
      data: {
        senderId: BigInt(adminTgId.trim()),
        senderName: 'SYSTEM_LOG',
        text: `[ADMIN ACTION: ${action}] target=${targetId}`,
        isAdmin: true,
      },
    });
  }

  // POST /api/admin/user/balance
  @Post('user/balance')
  async setBalance(
    @Body('adminTgId') adminTgId: string,
    @Body('targetTgId') targetTgId: string,
    @Body('amountRubles') amountRubles: number,
  ) {
    await this.verifyAdmin(adminTgId, 'SET_BALANCE', targetTgId);

    if (typeof amountRubles !== 'number' || amountRubles < 0 || isNaN(amountRubles)) {
      throw new BadRequestException('Сумма должна быть неотрицательным числом.');
    }

    const telegramId = BigInt(targetTgId.trim());
    const centsAmount = BigInt(Math.round(amountRubles * 100));

    const user = await this.prisma.user.findUnique({ where: { telegramId } });
    if (!user) throw new BadRequestException('Пользователь не найден.');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { balanceCents: centsAmount },
    });

    this.logger.log(`[ADMIN] Баланс пользователя tgId=${targetTgId} установлен: ${amountRubles} ₽`);
    return new ApiResponse({ message: `Баланс установлен: ${amountRubles} ₽` });
  }

  // POST /api/admin/user/ban
  @Post('user/ban')
  async banUser(
    @Body('adminTgId') adminTgId: string,
    @Body('targetTgId') targetTgId: string,
  ) {
    await this.verifyAdmin(adminTgId, 'BAN_USER', targetTgId);

    const telegramId = BigInt(targetTgId.trim());
    const user = await this.prisma.user.findUnique({ where: { telegramId } });
    if (!user) throw new BadRequestException('Пользователь не найден.');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`[ADMIN] Пользователь tgId=${targetTgId} забанен`);
    return new ApiResponse({ message: 'Пользователь заблокирован.' });
  }

  // POST /api/admin/user/unban
  @Post('user/unban')
  async unbanUser(
    @Body('adminTgId') adminTgId: string,
    @Body('targetTgId') targetTgId: string,
  ) {
    await this.verifyAdmin(adminTgId, 'UNBAN_USER', targetTgId);

    const telegramId = BigInt(targetTgId.trim());
    const user = await this.prisma.user.findUnique({ where: { telegramId } });
    if (!user) throw new BadRequestException('Пользователь не найден.');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: null },
    });

    this.logger.log(`[ADMIN] Пользователь tgId=${targetTgId} разблокирован`);
    return new ApiResponse({ message: 'Пользователь разблокирован.' });
  }

  // DELETE /api/admin/product/:id
  @Delete('product/:id')
  async archiveProduct(
    @Body('adminTgId') adminTgId: string,
    @Param('id') productId: string,
  ) {
    await this.verifyAdmin(adminTgId, 'ARCHIVE_PRODUCT', productId);

    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new BadRequestException('Товар не найден.');

    await this.prisma.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED' },
    });

    this.logger.log(`[ADMIN] Товар id=${productId} архивирован`);
    return new ApiResponse({ message: 'Товар снят с витрины.' });
  }
}