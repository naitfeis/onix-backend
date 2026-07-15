import {
  BadRequestException, Body, Controller, Injectable, Module, NotFoundException,
  Param, Post,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, canActAsSupport, parseId } from './common';
import { createDomainNotification, pushTelegramToChatId } from './domain-notify';
import { PrismaService } from './prisma.service';

class OpenSupportDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

class CloseSupportDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

/**
 * Order support tickets: open from any order status (incl. COMPLETED).
 * Adds isAdmin||isSupport users as ChatMembers (SUPPORT role, not Escrow bypass).
 * Refund stays in EscrowModule / ledger only.
 */
@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async open(user: AuthUser, orderId: bigint, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { chat: true, product: { select: { title: true } } },
    });
    if (!order || !order.chat) throw new NotFoundException('Сделка не найдена.');
    if (order.buyerId !== user.id && order.sellerId !== user.id && !canActAsSupport(user)) {
      throw new NotFoundException('Сделка не найдена.');
    }

    const open = await this.prisma.supportTicket.findFirst({
      where: { orderId, status: 'OPEN' },
      select: { id: true, chatId: true },
    });
    if (open) {
      return { ticketId: open.id, chatId: open.chatId, status: 'OPEN' as const };
    }

    const staff = await this.prisma.user.findMany({
      where: { OR: [{ isAdmin: true }, { isSupport: true }], deletedAt: null },
      select: { id: true, telegramId: true },
      take: 50,
    });

    const ticket = await this.prisma.$transaction(async (tx) => {
      for (const agent of staff) {
        await tx.chatMember.upsert({
          where: { chatId_userId: { chatId: order.chat!.id, userId: agent.id } },
          create: { chatId: order.chat!.id, userId: agent.id },
          update: {},
        });
      }
      const created = await tx.supportTicket.create({
        data: {
          orderId,
          chatId: order.chat!.id,
          openedById: user.id,
          status: 'OPEN',
        },
      });
      await tx.message.create({
        data: {
          chatId: order.chat!.id,
          kind: 'SYSTEM',
          senderId: null,
          text: reason?.trim()
            ? `Обращение в поддержку открыто.\nПричина: ${reason.trim()}`
            : 'Обращение в поддержку открыто. Администратор подключён к чату.',
        },
      });
      await tx.chat.update({ where: { id: order.chat!.id }, data: { updatedAt: new Date() } });
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
    for (const agent of staff) {
      void pushTelegramToChatId(
        agent.telegramId,
        'Открыт спор',
        `Заказ #${orderId} · ${order.product.title}`,
      );
    }

    return { ticketId: ticket.id, chatId: ticket.chatId, status: 'OPEN' as const };
  }

  async close(actor: AuthUser, ticketId: string, reason?: string) {
    if (!canActAsSupport(actor)) {
      throw new BadRequestException('Закрыть обращение может только поддержка.');
    }
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Обращение не найдено.');
    if (ticket.status === 'CLOSED') {
      return { ticketId: ticket.id, chatId: ticket.chatId, status: 'CLOSED' as const };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      await tx.message.create({
        data: {
          chatId: ticket.chatId,
          kind: 'SYSTEM',
          senderId: null,
          text: reason?.trim()
            ? `Обращение закрыто поддержкой.\n${reason.trim()}`
            : 'Обращение закрыто поддержкой.',
        },
      });
      await tx.chat.update({ where: { id: ticket.chatId }, data: { updatedAt: new Date() } });
    });
    return { ticketId: ticket.id, chatId: ticket.chatId, status: 'CLOSED' as const };
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

  @Post('support/tickets/:id/close')
  close(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CloseSupportDto,
  ) {
    if (!/^[a-z0-9]+$/i.test(id) || id.length < 8 || id.length > 40) {
      throw new BadRequestException('Некорректный ticket id.');
    }
    return this.support.close(user, id, dto.reason);
  }
}

@Module({ controllers: [SupportController], providers: [SupportService] })
export class SupportModule {}
