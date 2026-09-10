import {
  BadRequestException, Body, ConflictException, Controller, Get, Header, Injectable, Module,
  NotFoundException, Param, Post,
} from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ensurePairChat } from './chat-pair';
import { AuthUser, CurrentUser, parseId } from './common';
import { assertRateLimit } from './rate-limit';
import { lockOrderForUpdate, lockUsersInIdOrder } from './database/money-locks';
import { withSerializableTransaction } from './database/transaction-retry';
import { createDomainNotification, deliverTelegramAfterCommit, pushTelegramToChatId } from './domain-notify';
import { invalidateArbitrationContextCache } from './dispute-card';
import { EconomyModule } from './economy/economy.module';
import { LockService } from './economy/wallet/lock.service';
import { PrismaService } from './prisma.service';
import { SupportCenterService } from './support-center.service';
import { RiskModule } from './risk/risk.module';
import {
  DISPUTE_FROM,
  OPEN_SUPPORT_TICKET_STATUSES as OPEN_TICKET_STATUSES,
} from './order-state-machine';

class AppealDto {
  @IsString() @MaxLength(2000) explanation!: string;
}

class OpenSupportDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  /** Optional client key — natural reuse of open ticket is primary; key binds dispute transition. */
  @IsOptional() @IsString() @Length(16, 100) idempotencyKey?: string;
}

const SUPPORT_ELIGIBLE_ORDER = new Set<string>([
  ...DISPUTE_FROM,
  'DISPUTE',
  'COMPLETED',
  'CANCELED',
  'REFUNDED',
]);

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockService,
  ) {}

  /**
   * Open (or re-open) support on an order:
   * - creates/reuses ticket
   * - moves PAYMENT_HOLD|DELIVERING → DISPUTE (blocks buyer complete / seller deliver)
   */
  async open(user: AuthUser, orderId: bigint, reason?: string, idempotencyKey?: string) {
    const orderPeek = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { product: { select: { title: true } } },
    });
    if (!orderPeek) throw new NotFoundException('Сделка не найдена.');
    if (orderPeek.buyerId !== user.id && orderPeek.sellerId !== user.id) {
      throw new NotFoundException('Сделка не найдена.');
    }

    const openExisting = await this.prisma.supportTicket.findFirst({
      where: { orderId, status: { in: [...OPEN_TICKET_STATUSES] } },
      select: { id: true, chatId: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    if (openExisting) {
      return { ticketId: openExisting.id, chatId: openExisting.chatId, status: openExisting.status };
    }

    if (!SUPPORT_ELIGIBLE_ORDER.has(orderPeek.status)) {
      throw new BadRequestException('Обращение в поддержку недоступно в текущем статусе сделки.');
    }

    const counterpartIds = [orderPeek.buyerId, orderPeek.sellerId].filter((id) => id !== user.id);
    const trimmed = reason?.trim() || null;

    const { ticket, notifyIds } = await withSerializableTransaction(this.prisma, async (tx) => {
      await lockOrderForUpdate(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Сделка не найдена.');
      if (order.buyerId !== user.id && order.sellerId !== user.id) {
        throw new NotFoundException('Сделка не найдена.');
      }

      const stillOpen = await tx.supportTicket.findFirst({
        where: { orderId, status: { in: [...OPEN_TICKET_STATUSES] } },
        select: { id: true, chatId: true, status: true },
      });
      if (stillOpen) {
        return { ticket: stillOpen, notifyIds: [] as bigint[] };
      }

      if (!SUPPORT_ELIGIBLE_ORDER.has(order.status)) {
        throw new ConflictException('Обращение в поддержку недоступно в текущем статусе сделки.');
      }

      await lockUsersInIdOrder(tx, [order.buyerId, order.sellerId]);

      const chat = order.chatId
        ? { id: order.chatId }
        : await ensurePairChat(tx, order.buyerId, order.sellerId);
      if (!order.chatId) {
        await tx.order.update({ where: { id: orderId }, data: { chatId: chat.id } });
      }

      if ((DISPUTE_FROM as readonly string[]).includes(order.status)) {
        const changed = await tx.order.updateMany({
          where: { id: orderId, status: order.status },
          data: { status: 'DISPUTE', disputeReason: trimmed },
        });
        if (!changed.count) throw new ConflictException('Состояние сделки уже изменилось.');
        const disputeKey = (idempotencyKey?.trim() && idempotencyKey.trim().length >= 16)
          ? idempotencyKey.trim()
          : `order:${orderId}:support-dispute`;
        const existingTransition = await tx.orderTransition.findUnique({
          where: { idempotencyKey: disputeKey },
          select: { id: true },
        });
        if (!existingTransition) {
          await tx.orderTransition.create({
            data: {
              orderId,
              from: order.status,
              to: 'DISPUTE',
              actorId: user.id,
              idempotencyKey: disputeKey,
              reason: trimmed,
            },
          });
        }
        await this.locks.holdForDispute(tx, orderId);
      } else if (trimmed) {
        await tx.order.update({
          where: { id: orderId },
          data: { disputeReason: trimmed },
        });
      }

      const created = await tx.supportTicket.create({
        data: {
          orderId,
          chatId: chat.id,
          openedById: user.id,
          status: 'OPEN',
          category: 'ORDER_DISPUTE',
          priority: 'HIGH',
          subject: `Сделка #${orderId}`,
          body: trimmed,
        },
      });
      await tx.message.create({
        data: {
          chatId: chat.id,
          kind: 'SYSTEM',
          senderId: null,
          text: trimmed
            ? `Обращение в поддержку открыто. Сделка переведена в спор.\nПричина: ${trimmed}`
            : 'Обращение в поддержку открыто. Сделка переведена в спор — ожидает ответа поддержки.',
        },
      });
      await tx.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'ORDER_SUPPORT_OPEN',
          entity: 'Order',
          entityId: orderId.toString(),
          metadata: { ticketId: created.id, ...(trimmed ? { reason: trimmed } : {}) },
        },
      });

      const ids: bigint[] = [];
      for (const uid of counterpartIds) {
        const note = await createDomainNotification(tx, {
          userId: uid,
          type: 'ORDER_UPDATE',
          title: 'Открыт спор / поддержка',
          body: `Заказ #${orderId}: обращение в поддержку`,
          data: { orderId: orderId.toString(), ticketId: created.id },
        });
        ids.push(note.id);
      }
      return { ticket: created, notifyIds: ids };
    });

    deliverTelegramAfterCommit(this.prisma, notifyIds);
    const adminTg = process.env.ADMIN_TELEGRAM_ID?.trim();
    if (adminTg && /^\d+$/.test(adminTg)) {
      void pushTelegramToChatId(
        BigInt(adminTg),
        'Открыт спор',
        `Заказ #${orderId} · ${orderPeek.product.title}`,
      );
    }

    invalidateArbitrationContextCache();
    return { ticketId: ticket.id, chatId: ticket.chatId, status: 'OPEN' as const };
  }
}

@Controller()
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly center: SupportCenterService,
  ) {}

  @Post('orders/:id/support')
  open(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: OpenSupportDto,
  ) {
    assertRateLimit(`order:support:${user.id}`, 20, 60_000);
    return this.support.open(user, parseId(id), dto.reason, dto.idempotencyKey);
  }

  @Post('support/appeals')
  appeal(@CurrentUser() user: AuthUser, @Body() dto: AppealDto) {
    assertRateLimit(`support:appeal:${user.id}`, 8, 60_000);
    const text = dto.explanation.trim();
    if (text.length < 8) throw new BadRequestException('Опишите ситуацию подробнее.');
    return this.center.createAppeal(user.id, text);
  }

  @Get('support/tickets')
  @Header('Cache-Control', 'private, no-store')
  myTickets(@CurrentUser() user: AuthUser) {
    return this.center.listMine(user.id);
  }
}

@Module({
  imports: [RiskModule, EconomyModule],
  controllers: [SupportController],
  providers: [SupportService, SupportCenterService],
  exports: [SupportService, SupportCenterService],
})
export class SupportModule {}
