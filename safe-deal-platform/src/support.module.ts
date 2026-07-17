import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Header, Injectable, Module,
  NotFoundException, Param, Post,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ensurePairChat } from './chat-pair';
import { AuthUser, CurrentUser, canActAsSupport, parseId } from './common';
import { createDomainNotification, pushTelegramToChatId } from './domain-notify';
import { formatOnixId } from './onix-id';
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
    if (!order) throw new NotFoundException('Сделка не найдена.');
    if (order.buyerId !== user.id && order.sellerId !== user.id && !canActAsSupport(user)) {
      throw new NotFoundException('Сделка не найдена.');
    }

    // One complaint per order (support ticket or already in dispute).
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

    const staff = await this.prisma.user.findMany({
      where: { OR: [{ isAdmin: true }, { isSupport: true }], deletedAt: null },
      select: { id: true, telegramId: true },
      take: 50,
    });

    // Join existing buyer↔seller pair chat via ChatMember — never create a separate support chat.
    const ticket = await this.prisma.$transaction(async (tx) => {
      const chat = order.chatId
        ? { id: order.chatId }
        : await ensurePairChat(tx, order.buyerId, order.sellerId);
      if (!order.chatId) {
        await tx.order.update({ where: { id: orderId }, data: { chatId: chat.id } });
      }
      for (const agent of staff) {
        await tx.chatMember.upsert({
          where: { chatId_userId: { chatId: chat.id, userId: agent.id } },
          create: { chatId: chat.id, userId: agent.id },
          update: {},
        });
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

  /**
   * Admin/support inbox: open support tickets + orders in DISPUTE.
   * Resolved (refund / admin-complete) tickets leave the queue.
   */
  async listQueue(actor: AuthUser) {
    if (!canActAsSupport(actor)) {
      throw new ForbiddenException('Очередь поддержки доступна только staff.');
    }
    const [tickets, disputes] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          chatId: true,
          createdAt: true,
          order: {
            select: {
              id: true,
              status: true,
              totalAmountCents: true,
              disputeReason: true,
              product: { select: { title: true } },
              buyer: { select: { onixId: true, telegramNick: true, displayName: true } },
              seller: { select: { onixId: true, telegramNick: true, displayName: true } },
              chat: { select: { id: true } },
            },
          },
        },
      }),
      this.prisma.order.findMany({
        where: { status: 'DISPUTE' },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          status: true,
          totalAmountCents: true,
          disputeReason: true,
          createdAt: true,
          product: { select: { title: true } },
          buyer: { select: { onixId: true, telegramNick: true, displayName: true } },
          seller: { select: { onixId: true, telegramNick: true, displayName: true } },
          chat: { select: { id: true } },
          supportTickets: {
            where: { status: 'OPEN' },
            select: { id: true, chatId: true },
            take: 1,
          },
        },
      }),
    ]);

    const byOrder = new Map<string, {
      orderId: string;
      status: string;
      productTitle: string;
      totalAmountCents: string;
      chatId: string | null;
      ticketId: string | null;
      reason: string | null;
      buyer: { onixId: string; username: string };
      seller: { onixId: string; username: string };
      createdAt: string;
      kind: 'SUPPORT' | 'DISPUTE';
    }>();

    const party = (u: { onixId: string; telegramNick: string | null; displayName: string | null }) => ({
      onixId: formatOnixId(u.onixId),
      username: u.telegramNick ?? u.displayName ?? formatOnixId(u.onixId),
    });

    for (const t of tickets) {
      const id = t.order.id.toString();
      byOrder.set(id, {
        orderId: id,
        status: t.order.status,
        productTitle: t.order.product.title,
        totalAmountCents: t.order.totalAmountCents.toString(),
        chatId: t.chatId || t.order.chat?.id || null,
        ticketId: t.id,
        reason: t.order.disputeReason,
        buyer: party(t.order.buyer),
        seller: party(t.order.seller),
        createdAt: t.createdAt.toISOString(),
        kind: t.order.status === 'DISPUTE' ? 'DISPUTE' : 'SUPPORT',
      });
    }
    for (const o of disputes) {
      const id = o.id.toString();
      if (byOrder.has(id)) continue;
      byOrder.set(id, {
        orderId: id,
        status: o.status,
        productTitle: o.product.title,
        totalAmountCents: o.totalAmountCents.toString(),
        chatId: o.supportTickets[0]?.chatId || o.chat?.id || null,
        ticketId: o.supportTickets[0]?.id ?? null,
        reason: o.disputeReason,
        buyer: party(o.buyer),
        seller: party(o.seller),
        createdAt: o.createdAt.toISOString(),
        kind: 'DISPUTE',
      });
    }

    return [...byOrder.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /** People reports inbox for staff (open only). */
  async listReports(actor: AuthUser) {
    if (!canActAsSupport(actor)) {
      throw new ForbiddenException('Жалобы доступны только staff.');
    }
    const rows = await this.prisma.userReport.findMany({
      where: { closedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        reason: true,
        comment: true,
        createdAt: true,
        reporter: { select: { onixId: true, telegramNick: true, displayName: true, avatarUrl: true } },
        target: { select: { onixId: true, telegramNick: true, displayName: true, avatarUrl: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      reporter: {
        onixId: formatOnixId(r.reporter.onixId),
        username: r.reporter.telegramNick ?? r.reporter.displayName ?? formatOnixId(r.reporter.onixId),
        avatarUrl: r.reporter.avatarUrl ?? undefined,
      },
      target: {
        onixId: formatOnixId(r.target.onixId),
        username: r.target.telegramNick ?? r.target.displayName ?? formatOnixId(r.target.onixId),
        avatarUrl: r.target.avatarUrl ?? undefined,
      },
    }));
  }

  async closeReport(actor: AuthUser, reportId: string, reason?: string) {
    if (!canActAsSupport(actor)) {
      throw new ForbiddenException('Закрыть жалобу может только staff.');
    }
    if (!/^[a-z0-9]+$/i.test(reportId) || reportId.length < 8 || reportId.length > 40) {
      throw new BadRequestException('Некорректный id жалобы.');
    }
    const report = await this.prisma.userReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Жалоба не найдена.');
    if (report.closedAt) {
      return { id: report.id, closed: true as const };
    }
    await this.prisma.userReport.update({
      where: { id: reportId },
      data: {
        closedAt: new Date(),
        closedById: actor.id,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'USER_REPORT_CLOSE',
        entity: 'UserReport',
        entityId: reportId,
        metadata: reason?.trim() ? { reason: reason.trim().slice(0, 500) } : undefined,
      },
    });
    return { id: reportId, closed: true as const };
  }
}

@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('support/queue')
  @Header('Cache-Control', 'private, no-store')
  queue(@CurrentUser() user: AuthUser) {
    return this.support.listQueue(user);
  }

  @Get('support/reports')
  @Header('Cache-Control', 'private, no-store')
  reports(@CurrentUser() user: AuthUser) {
    return this.support.listReports(user);
  }

  @Post('support/reports/:id/close')
  closeReport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CloseSupportDto,
  ) {
    return this.support.closeReport(user, id, dto.reason);
  }

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
