import {
  BadRequestException, Body, Controller, Injectable, Module, NotFoundException, Param, Post,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ensurePairChat } from './chat-pair';
import { AuthUser, CurrentUser, parseId } from './common';
import { createDomainNotification, pushTelegramToChatId } from './domain-notify';
import { invalidateArbitrationContextCache } from './dispute-card';
import { PrismaService } from './prisma.service';

class OpenSupportDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async open(user: AuthUser, orderId: bigint, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { chat: true, product: { select: { title: true } } },
    });
    if (!order) throw new NotFoundException('Сделка не найдена.');
    if (order.buyerId !== user.id && order.sellerId !== user.id) {
      throw new NotFoundException('Сделка не найдена.');
    }

    const existingAny = await this.prisma.supportTicket.findFirst({
      where: { orderId },
      select: { id: true, chatId: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existingAny) {
      if (existingAny.status === 'OPEN') {
        return { ticketId: existingAny.id, chatId: existingAny.chatId, status: 'OPEN' as const };
      }
      throw new BadRequestException('По этой сделке обращение уже было создано.');
    }
    if (order.status === 'DISPUTE') {
      throw new BadRequestException('По этой сделке уже открыт спор.');
    }

    const ticket = await this.prisma.$transaction(async (tx) => {
      const chat = order.chatId
        ? { id: order.chatId }
        : await ensurePairChat(tx, order.buyerId, order.sellerId);
      if (!order.chatId) {
        await tx.order.update({ where: { id: orderId }, data: { chatId: chat.id } });
      }
      const created = await tx.supportTicket.create({
        data: {
          orderId,
          chatId: chat.id,
          openedById: user.id,
          status: 'OPEN',
        },
      });
      await tx.message.create({
        data: {
          chatId: chat.id,
          kind: 'SYSTEM',
          senderId: null,
          text: reason?.trim()
            ? `Обращение в поддержку открыто.\nПричина: ${reason.trim()}`
            : 'Обращение в поддержку открыто. Администратор подключён к чату.',
        },
      });
      await tx.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
      return created;
    });

    const counterpartIds = [order.buyerId, order.sellerId].filter((id) => id !== user.id);
    for (const uid of counterpartIds) {
      await createDomainNotification(this.prisma, {
        userId: uid,
        type: 'ORDER_UPDATE',
        title: 'Открыт спор / поддержка',
        body: `Заказ #${orderId}: обращение в поддержку`,
        data: { orderId: orderId.toString(), ticketId: ticket.id },
      });
    }
    const adminTg = process.env.ADMIN_TELEGRAM_ID?.trim();
    if (adminTg && /^\d+$/.test(adminTg)) {
      void pushTelegramToChatId(
        BigInt(adminTg),
        'Открыт спор',
        `Заказ #${orderId} · ${order.product.title}`,
      );
    }

    invalidateArbitrationContextCache();
    return { ticketId: ticket.id, chatId: ticket.chatId, status: 'OPEN' as const };
  }
}

@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('orders/:id/support')
  open(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: OpenSupportDto,
  ) {
    return this.support.open(user, parseId(id), dto.reason);
  }
}

@Module({
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
