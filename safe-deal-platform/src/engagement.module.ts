import {
  BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module,
  NotFoundException, Param, Patch, Post, Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser, parseId } from './common';
import { createDomainNotification, pushTelegramToChatId } from './domain-notify';
import { PrismaService } from './prisma.service';
import { messageDto, notificationDto, reviewDto } from './response';

class DirectChatDto { @IsString() @Length(7, 20) onixId!: string; }
class MessageDto { @IsString() @Length(1, 2000) text!: string; }
class MessagesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  /** Cursor: load messages with id strictly less than this (older page). */
  @IsOptional() @IsString() @Length(1, 30) before?: string;
}
class ReviewDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @Length(1, 1000) text?: string;
}

/**
 * Chat + notification domain (HTTP polling today; methods are WS-ready — no transport in service).
 * Access: ChatMember only. senderId always = CurrentUser (never from body).
 * Read: opening a chat marks the thread read via ChatMember.updateMany (not per-message).
 */
@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    // Presence heartbeat (architecture for Stage 5.6 WebSocket presence).
    void this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    const chats = await this.prisma.chat.findMany({
      where: { members: { some: { userId: user.id } } },
      include: {
        members: {
          where: { OR: [{ userId: user.id }, { userId: { not: user.id } }] },
          include: {
            user: {
              select: {
                onixId: true, displayName: true, telegramNick: true, lastSeenAt: true, avatarUrl: true,
                isAdmin: true, isSupport: true,
              },
            },
          },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { text: true, kind: true } },
        order: { select: { id: true, status: true, totalAmountCents: true, product: { select: { title: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    if (chats.length === 0) return [];

    const threads = await Promise.all(chats.map(async (chat) => {
      const me = chat.members.find((member) => member.userId === user.id);
      const other = chat.members.find((member) => member.userId !== user.id);
      const unreadCount = await this.prisma.message.count({
        where: {
          chatId: chat.id,
          kind: 'USER',
          senderId: { not: user.id },
          ...(me?.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {}),
        },
      });
      return {
        id: chat.id,
        title: other?.user.displayName ?? other?.user.telegramNick ?? other?.user.onixId ?? 'Диалог',
        subtitle: chat.messages[0]?.text,
        unreadCount,
        peerOnixId: other?.user.onixId,
        peerLastOnline: other?.user.lastSeenAt?.toISOString(),
        ...(other?.user.avatarUrl ? { peerAvatarUrl: other.user.avatarUrl } : {}),
        ...(other?.user.isAdmin ? { peerBadge: 'ADMIN' as const } : other?.user.isSupport ? { peerBadge: 'SUPPORT' as const } : {}),
        ...(chat.orderId && chat.order ? {
          dealId: chat.orderId.toString(),
          orderCard: {
            id: chat.orderId.toString(),
            productTitle: chat.order.product.title,
            totalAmountCents: chat.order.totalAmountCents.toString(),
            status: chat.order.status,
            escrow: true,
          },
        } : {}),
      };
    }));
    return threads;
  }

  async direct(user: AuthUser, onixId: string) {
    const target = await this.prisma.user.findUnique({ where: { onixId } });
    if (!target) throw new NotFoundException('Пользователь не найден.');
    if (target.id === user.id) throw new BadRequestException('Нельзя открыть чат с собой.');
    await this.assertNotBlocked(user.id, target.id);

    const chat = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.chat.findFirst({
        where: {
          orderId: null,
          AND: [
            { members: { some: { userId: user.id } } },
            { members: { some: { userId: target.id } } },
          ],
        },
      });
      if (existing) return existing;
      return tx.chat.create({
        data: { members: { create: [{ userId: user.id }, { userId: target.id }] } },
      });
    });

    return {
      id: chat.id,
      title: target.displayName ?? target.telegramNick ?? target.onixId,
      unreadCount: 0,
      peerOnixId: target.onixId,
      peerLastOnline: target.lastSeenAt.toISOString(),
      ...(target.avatarUrl ? { peerAvatarUrl: target.avatarUrl } : {}),
    };
  }

  async messages(user: AuthUser, chatId: string, limit: number, before?: string) {
    await this.member(user.id, chatId);
    const take = Math.min(Math.max(limit, 1), 100);
    const beforeId = before ? parseId(before) : undefined;
    const rows = await this.prisma.message.findMany({
      where: {
        chatId,
        ...(beforeId !== undefined ? { id: { lt: beforeId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: { sender: { select: { id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true, isAdmin: true, isSupport: true } } },
    });
    // Mark entire thread read in one updateMany — not per-message.
    await this.prisma.chatMember.updateMany({
      where: { chatId, userId: user.id },
      data: { lastReadAt: new Date() },
    });
    void this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });
    return rows.reverse().map((message) => messageDto(message, user.id));
  }

  async send(user: AuthUser, chatId: string, text: string) {
    await this.member(user.id, chatId);
    const body = text.trim();
    if (!body) throw new BadRequestException('Сообщение не может быть пустым.');
    const other = await this.prisma.chatMember.findFirst({ where: { chatId, userId: { not: user.id } } });
    if (!other) throw new BadRequestException('В чате нет получателя.');
    await this.assertNotBlocked(user.id, other.userId);

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { chatId, senderId: user.id, kind: 'USER', text: body },
        include: { sender: { select: { id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true, isAdmin: true, isSupport: true } } },
      });
      await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
      await createDomainNotification(tx, {
        userId: other.userId,
        type: 'NEW_MESSAGE',
        title: 'Новое сообщение',
        body: body.slice(0, 160),
        data: { chatId },
      });
      return created;
    });

    const peer = await this.prisma.user.findUnique({
      where: { id: other.userId },
      select: { telegramId: true },
    });
    if (peer) {
      void pushTelegramToChatId(peer.telegramId, 'Новое сообщение', body.slice(0, 200));
    }

    return messageDto(message, user.id);
  }

  private async member(userId: bigint, chatId: string) {
    const member = await this.prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId } } });
    if (!member) throw new NotFoundException('Чат не найден.');
    return member;
  }

  private async assertNotBlocked(a: bigint, b: bigint) {
    const blocked = await this.prisma.userBlock.findFirst({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    });
    if (blocked) throw new BadRequestException('Обмен сообщениями между пользователями заблокирован.');
  }
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const items = await this.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, title: true, body: true, readAt: true, createdAt: true },
    });
    return items.map(notificationDto);
  }

  /** Own notification only — updateMany prevents cross-user mark-read races. */
  read(user: AuthUser, id: bigint) {
    return this.prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { readAt: new Date() },
    });
  }
}

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async list(onixId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { subject: { onixId } },
      include: { author: { select: { id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true, isAdmin: true, isSupport: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return reviews.map(reviewDto);
  }

  async create(user: AuthUser, orderId: bigint, dto: ReviewDto) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order || order.status !== 'COMPLETED') {
          throw new BadRequestException('Отзыв доступен только после завершённой сделки.');
        }
        if (order.buyerId !== user.id) {
          throw new BadRequestException('Отзыв может оставить только покупатель продавцу.');
        }
        const subjectId = order.sellerId;
        if (subjectId === user.id) {
          throw new BadRequestException('Нельзя оставить отзыв самому себе.');
        }
        const existing = await tx.review.findUnique({
          where: { orderId_authorId: { orderId, authorId: user.id } },
        });
        if (existing) {
          throw new ConflictException('Отзыв по этой сделке уже оставлен.');
        }
        const review = await tx.review.create({
          data: {
            orderId,
            authorId: user.id,
            subjectId,
            rating: dto.rating,
            ...(dto.text !== undefined ? { text: dto.text } : {}),
          },
        });
        const aggregate = await tx.review.aggregate({
          where: { subjectId },
          _avg: { rating: true },
          _count: true,
        });
        const average = aggregate._avg.rating ?? 0;
        await tx.user.update({
          where: { id: subjectId },
          data: {
            ratingAverage: Math.round(average * 100) / 100,
            ratingCount: aggregate._count,
          },
        });
        await createDomainNotification(tx, {
          userId: subjectId,
          type: 'NEW_REVIEW',
          title: 'Оставлен отзыв',
          body: `Оценка: ${dto.rating}/5`,
          data: { reviewId: review.id.toString() },
        });
        const row = await tx.review.findUniqueOrThrow({
          where: { id: review.id },
          include: { author: { select: { id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true, isAdmin: true, isSupport: true } } },
        });
        return { dto: reviewDto(row), subjectId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      const subject = await this.prisma.user.findUnique({
        where: { id: result.subjectId },
        select: { telegramId: true },
      });
      if (subject) {
        void pushTelegramToChatId(subject.telegramId, 'Оставлен отзыв', `Оценка: ${dto.rating}/5`);
      }
      return result.dto;
    } catch (error) {
      if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException('Отзыв по этой сделке уже оставлен.');
      }
      throw error;
    }
  }
}

@Controller()
export class EngagementController {
  constructor(
    private readonly chats: ChatService,
    private readonly notifications: NotificationService,
    private readonly reviews: ReviewService,
  ) {}

  @Get('chats') listChats(@CurrentUser() user: AuthUser) { return this.chats.list(user); }
  @Post('chats/direct') direct(@CurrentUser() user: AuthUser, @Body() dto: DirectChatDto) {
    return this.chats.direct(user, dto.onixId);
  }
  @Get('chats/:id/messages') messages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: MessagesQuery,
  ) {
    return this.chats.messages(user, id, query.limit, query.before);
  }
  @Post('chats/:id/messages') send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MessageDto,
  ) {
    return this.chats.send(user, id, dto.text);
  }

  @Get('notifications') listNotifications(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user);
  }
  @Patch('notifications/:id/read') readNotification(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.read(user, parseId(id));
  }

  @Get('users/:onixId/reviews') listReviews(@Param('onixId') id: string) { return this.reviews.list(id); }
  @Post('orders/:id/reviews') createReview(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.reviews.create(user, parseId(id), dto);
  }
}

@Module({
  controllers: [EngagementController],
  providers: [ChatService, NotificationService, ReviewService],
})
export class EngagementModule {}
