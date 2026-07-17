import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Header,
  Injectable, Module, NotFoundException, Param, Patch, Post, Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min,
} from 'class-validator';
import { ensurePairChat, pairChatKey } from './chat-pair';
import { AuthUser, CurrentUser, parseId } from './common';
import { createDomainNotification, pushTelegramToChatId } from './domain-notify';
import { formatOnixId, onixIdLookupCandidates } from './onix-id';
import { requireUserByOnixId } from './onix-id-lookup';
import { PrismaService } from './prisma.service';
import { messageDto, notificationDto, reviewDto } from './response';

class DirectChatDto { @IsString() @Length(1, 32) onixId!: string; }
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
class CreateGroupDto {
  @IsString() @Length(1, 80) title!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40)
  @IsString({ each: true }) @Length(1, 32, { each: true })
  memberOnixIds!: string[];
}
class UserSearchQuery {
  @IsString() @Length(1, 64) q!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) limit = 20;
}
class DeleteMessageDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const SENDER_SELECT = {
  id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true, isAdmin: true, isSupport: true,
} as const;

/**
 * Chat + notification domain (HTTP polling today; methods are WS-ready — no transport in service).
 * Access: ChatMember only. senderId always = CurrentUser (never from body).
 * Read: opening a chat marks the thread read via ChatMember.updateMany (not per-message).
 * Personal chats: exactly one per user pair via Chat.pairKey (Direct + all Escrow deals).
 */
@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, search?: string) {
    void this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    const q = search?.trim();
    const chats = await this.prisma.chat.findMany({
      where: {
        members: { some: { userId: user.id } },
        ...(q ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            {
              members: {
                some: {
                  userId: { not: user.id },
                  user: {
                    OR: [
                      { telegramNick: { contains: q, mode: 'insensitive' } },
                      { displayName: { contains: q, mode: 'insensitive' } },
                      { onixId: { in: onixIdLookupCandidates(q) } },
                    ],
                  },
                },
              },
            },
          ],
        } : {}),
      },
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
        messages: {
          where: {
            OR: [{ visibleToUserId: null }, { visibleToUserId: user.id }],
            hides: { none: { userId: user.id } },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { text: true, kind: true, deletedAt: true },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, totalAmountCents: true, product: { select: { title: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    if (chats.length === 0) return [];

    const chatIds = chats.map((chat) => chat.id);
    const unreadRows = await this.prisma.$queryRaw<Array<{ chatId: string; cnt: bigint }>>`
      SELECT m."chatId" AS "chatId", COUNT(*)::bigint AS cnt
      FROM "Message" m
      INNER JOIN "ChatMember" cm
        ON cm."chatId" = m."chatId" AND cm."userId" = ${user.id}
      WHERE m."chatId" IN (${Prisma.join(chatIds)})
        AND m.kind = 'USER'
        AND m."senderId" IS NOT NULL
        AND m."senderId" <> ${user.id}
        AND m."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "MessageHide" h
          WHERE h."messageId" = m.id AND h."userId" = ${user.id}
        )
        AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
      GROUP BY m."chatId"
    `;
    const unreadByChat = new Map(unreadRows.map((row) => [row.chatId, Number(row.cnt)]));

    return chats.map((chat) => {
      const isGroup = chat.kind === 'GROUP';
      const other = chat.members.find((member) => (
        member.userId !== user.id
        && !member.user.isAdmin
        && !member.user.isSupport
      )) ?? chat.members.find((member) => member.userId !== user.id);
      const latestOrder = chat.orders[0];
      const subtitleRaw = chat.messages[0];
      const subtitle = subtitleRaw?.deletedAt && !(user.isAdmin || user.isSupport)
        ? 'Сообщение удалено'
        : subtitleRaw?.text;
      const peerOnix = other?.user.onixId ? formatOnixId(other.user.onixId) : undefined;
      return {
        id: chat.id,
        kind: chat.kind,
        title: isGroup
          ? (chat.title ?? 'Группа')
          : (other?.user.displayName ?? other?.user.telegramNick ?? peerOnix ?? 'Диалог'),
        subtitle,
        unreadCount: unreadByChat.get(chat.id) ?? 0,
        peerOnixId: isGroup ? undefined : peerOnix,
        peerLastOnline: isGroup ? undefined : other?.user.lastSeenAt?.toISOString(),
        ...(!isGroup && other?.user.avatarUrl ? { peerAvatarUrl: other.user.avatarUrl } : {}),
        ...(!isGroup && other?.user.isAdmin ? { peerBadge: 'ADMIN' as const }
          : !isGroup && other?.user.isSupport ? { peerBadge: 'SUPPORT' as const } : {}),
        ...(latestOrder ? {
          dealId: latestOrder.id.toString(),
          orderCard: {
            id: latestOrder.id.toString(),
            productTitle: latestOrder.product.title,
            totalAmountCents: latestOrder.totalAmountCents.toString(),
            status: latestOrder.status,
            escrow: true,
          },
        } : {}),
      };
    });
  }

  async searchUsers(user: AuthUser, q: string, limit: number) {
    const query = q.trim();
    if (!query) return [];
    const take = Math.min(Math.max(limit, 1), 30);
    const candidates = onixIdLookupCandidates(query);
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        id: { not: user.id },
        OR: [
          { onixId: { in: candidates } },
          { telegramNick: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      take,
      select: {
        onixId: true, telegramNick: true, displayName: true, avatarUrl: true, isAdmin: true, isSupport: true,
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => {
      const onixId = formatOnixId(row.onixId);
      return {
        onixId,
        username: row.telegramNick ?? row.displayName ?? onixId,
        ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
        ...(row.isAdmin ? { badge: 'ADMIN' as const } : row.isSupport ? { badge: 'SUPPORT' as const } : {}),
      };
    });
  }

  async createGroup(user: AuthUser, title: string, memberOnixIds: string[]) {
    const name = title.trim();
    if (!name) throw new BadRequestException('Укажите название группы.');
    const unique = [...new Set(memberOnixIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length < 1) throw new BadRequestException('Добавьте хотя бы одного участника.');
    const members: Array<{ id: bigint; onixId: string; deletedAt: Date | null }> = [];
    for (const raw of unique) {
      const u = await requireUserByOnixId(this.prisma, raw);
      if (u.id === user.id) continue;
      if (u.deletedAt) throw new BadRequestException(`Пользователь ${formatOnixId(u.onixId)} недоступен.`);
      members.push({ id: u.id, onixId: u.onixId, deletedAt: u.deletedAt });
    }
    if (members.length < 1) throw new BadRequestException('Добавьте хотя бы одного участника.');

    const chat = await this.prisma.$transaction(async (tx) => {
      const created = await tx.chat.create({
        data: {
          kind: 'GROUP',
          title: name.slice(0, 80),
          members: {
            create: [
              { userId: user.id },
              ...members.map((m) => ({ userId: m.id })),
            ],
          },
        },
      });
      await tx.message.create({
        data: {
          chatId: created.id,
          senderId: null,
          kind: 'SYSTEM',
          text: `Группа «${name.slice(0, 80)}» создана.`,
        },
      });
      return created;
    }, SERIALIZABLE);

    return {
      id: chat.id,
      kind: 'GROUP' as const,
      title: name.slice(0, 80),
      unreadCount: 0,
    };
  }

  async direct(user: AuthUser, onixId: string) {
    const target = await requireUserByOnixId(this.prisma, onixId);
    if (target.id === user.id) throw new BadRequestException('Нельзя открыть чат с собой.');
    await this.assertNotBlocked(user.id, target.id);

    const pairKey = pairChatKey(user.id, target.id);
    let chat: { id: string };
    try {
      chat = await this.prisma.$transaction(
        (tx) => ensurePairChat(tx, user.id, target.id),
        SERIALIZABLE,
      );
    } catch (error) {
      if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code: string }).code === 'P2002'
      ) {
        chat = await this.prisma.chat.findUniqueOrThrow({ where: { pairKey } });
      } else {
        throw error;
      }
    }

    const peerOnix = formatOnixId(target.onixId);
    return {
      id: chat.id,
      kind: 'DIRECT' as const,
      title: target.displayName ?? target.telegramNick ?? peerOnix,
      unreadCount: 0,
      peerOnixId: peerOnix,
      peerLastOnline: target.lastSeenAt.toISOString(),
      ...(target.avatarUrl ? { peerAvatarUrl: target.avatarUrl } : {}),
    };
  }

  async messages(user: AuthUser, chatId: string, limit: number, before?: string) {
    await this.member(user.id, chatId);
    const take = Math.min(Math.max(limit, 1), 100);
    const beforeId = before ? parseId(before) : undefined;
    const staffViewer = user.isAdmin || user.isSupport;

    const memberRows = await this.prisma.chatMember.findMany({
      where: { chatId },
      include: {
        user: { select: { onixId: true, displayName: true, telegramNick: true } },
      },
    });
    const memberReads = memberRows.map((m) => ({
      userId: m.userId,
      onixId: m.user.onixId,
      username: m.user.telegramNick ?? m.user.displayName ?? formatOnixId(m.user.onixId),
      lastReadAt: m.lastReadAt,
    }));

    const rows = await this.prisma.message.findMany({
      where: {
        chatId,
        OR: [{ visibleToUserId: null }, { visibleToUserId: user.id }],
        hides: { none: { userId: user.id } },
        ...(beforeId !== undefined ? { id: { lt: beforeId } } : {}),
        // Non-staff: still see soft-deleted as placeholder (filter none); staff see all.
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: { sender: { select: SENDER_SELECT } },
    });

    await this.prisma.chatMember.updateMany({
      where: { chatId, userId: user.id },
      data: { lastReadAt: new Date() },
    });
    void this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    return rows.reverse().map((message) => messageDto(message, user.id, {
      staffViewer,
      memberReads,
    }));
  }

  async send(user: AuthUser, chatId: string, text: string) {
    await this.member(user.id, chatId);
    const body = text.trim();
    if (!body) throw new BadRequestException('Сообщение не может быть пустым.');

    const others = await this.prisma.chatMember.findMany({
      where: { chatId, userId: { not: user.id } },
      select: { userId: true },
    });
    if (others.length === 0) throw new BadRequestException('В чате нет получателя.');
    for (const other of others) {
      await this.assertNotBlocked(user.id, other.userId);
    }

    const memberRows = await this.prisma.chatMember.findMany({
      where: { chatId },
      include: { user: { select: { onixId: true, displayName: true, telegramNick: true } } },
    });
    const memberReads = memberRows.map((m) => ({
      userId: m.userId,
      onixId: m.user.onixId,
      username: m.user.telegramNick ?? m.user.displayName ?? formatOnixId(m.user.onixId),
      lastReadAt: m.lastReadAt,
    }));

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { chatId, senderId: user.id, kind: 'USER', text: body },
        include: { sender: { select: SENDER_SELECT } },
      });
      await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
      for (const other of others) {
        await createDomainNotification(tx, {
          userId: other.userId,
          type: 'NEW_MESSAGE',
          title: 'Новое сообщение',
          body: body.slice(0, 160),
          data: { chatId },
        });
      }
      return created;
    });

    const peers = await this.prisma.user.findMany({
      where: { id: { in: others.map((o) => o.userId) } },
      select: { telegramId: true },
    });
    for (const peer of peers) {
      void pushTelegramToChatId(peer.telegramId, 'Новое сообщение', body.slice(0, 200));
    }

    return messageDto(message, user.id, {
      staffViewer: user.isAdmin || user.isSupport,
      memberReads,
    });
  }

  /** Hide message for current user only. */
  async hideForSelf(user: AuthUser, chatId: string, messageId: bigint) {
    await this.member(user.id, chatId);
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, chatId },
    });
    if (!message) throw new NotFoundException('Сообщение не найдено.');
    await this.prisma.messageHide.upsert({
      where: { messageId_userId: { messageId, userId: user.id } },
      create: { messageId, userId: user.id },
      update: {},
    });
    return { ok: true, scope: 'SELF' as const };
  }

  /** Soft-delete globally — admin/support only. Row kept for audit. */
  async softDelete(user: AuthUser, chatId: string, messageId: bigint, reason?: string) {
    if (!user.isAdmin && !user.isSupport) {
      throw new ForbiddenException('Глобальное удаление доступно только модерации.');
    }
    await this.member(user.id, chatId);
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, chatId },
    });
    if (!message) throw new NotFoundException('Сообщение не найдено.');
    if (message.deletedAt) return { ok: true, scope: 'GLOBAL' as const };
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        deletedById: user.id,
        deletedReason: reason?.trim().slice(0, 500) || null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'MESSAGE_SOFT_DELETE',
        entity: 'Message',
        entityId: messageId.toString(),
        metadata: { chatId, reason: reason?.trim() ?? null },
      },
    });
    return { ok: true, scope: 'GLOBAL' as const };
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
    const subject = await requireUserByOnixId(this.prisma, onixId);
    const reviews = await this.prisma.review.findMany({
      where: { subjectId: subject.id },
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

  @Get('chats')
  @Header('Cache-Control', 'private, no-store')
  listChats(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.chats.list(user, q);
  }

  @Get('chats/users/search')
  @Header('Cache-Control', 'private, no-store')
  searchUsers(@CurrentUser() user: AuthUser, @Query() query: UserSearchQuery) {
    return this.chats.searchUsers(user, query.q, query.limit);
  }

  @Post('chats/direct') direct(@CurrentUser() user: AuthUser, @Body() dto: DirectChatDto) {
    return this.chats.direct(user, dto.onixId);
  }

  @Post('chats/groups')
  createGroup(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) {
    return this.chats.createGroup(user, dto.title, dto.memberOnixIds);
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

  @Delete('chats/:id/messages/:messageId')
  deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Query('scope') scope: string | undefined,
    @Body() body?: DeleteMessageDto,
  ) {
    const mid = parseId(messageId);
    if (scope === 'global') {
      return this.chats.softDelete(user, id, mid, body?.reason);
    }
    return this.chats.hideForSelf(user, id, mid);
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
