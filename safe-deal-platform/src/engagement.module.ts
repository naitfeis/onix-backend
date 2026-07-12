import {
  BadRequestException, Body, Controller, Get, Injectable, Module,
  NotFoundException, Param, Patch, Post, Query,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser, parseId } from './common';
import { PrismaService } from './prisma.service';
import { messageDto, notificationDto, reviewDto } from './response';

class DirectChatDto { @IsString() @Length(7, 20) onixId!: string; }
class MessageDto { @IsString() @Length(1, 2000) text!: string; }
class ReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @Length(1, 1000) text?: string;
}

@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService) {}

  async chats(user: AuthUser) {
    const chats = await this.prisma.chat.findMany({
      where: { members: { some: { userId: user.id } } },
      include: {
        members: { include: { user: { select: { onixId: true, displayName: true, telegramNick: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        order: { select: { id: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return Promise.all(chats.map(async (chat) => {
      const me = chat.members.find((member) => member.userId === user.id);
      const other = chat.members.find((member) => member.userId !== user.id);
      const unreadCount = await this.prisma.message.count({
        where: {
          chatId: chat.id,
          senderId: { not: user.id },
          ...(me?.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {}),
        },
      });
      return {
        id: chat.id,
        title: other?.user.displayName ?? other?.user.telegramNick ?? other?.user.onixId ?? 'Диалог',
        subtitle: chat.messages[0]?.text,
        unreadCount,
        ...(chat.orderId ? { dealId: chat.orderId.toString() } : {}),
      };
    }));
  }

  async direct(user: AuthUser, onixId: string) {
    const target = await this.prisma.user.findUnique({ where: { onixId } });
    if (!target) throw new NotFoundException('Пользователь не найден.');
    if (target.id === user.id) throw new BadRequestException('Нельзя открыть чат с собой.');
    await this.assertNotBlocked(user.id, target.id);
    const existing = await this.prisma.chat.findFirst({
      where: {
        orderId: null,
        AND: [
          { members: { some: { userId: user.id } } },
          { members: { some: { userId: target.id } } },
        ],
      },
    });
    const chat = existing ?? await this.prisma.chat.create({
      data: { members: { create: [{ userId: user.id }, { userId: target.id }] } },
    });
    return {
      id: chat.id,
      title: target.displayName ?? target.telegramNick ?? target.onixId,
      unreadCount: 0,
    };
  }

  async messages(user: AuthUser, chatId: string, limit = 50) {
    await this.member(user.id, chatId);
    const messages = await this.prisma.message.findMany({
      where: { chatId }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 100),
      include: { sender: { select: { id: true, onixId: true, displayName: true, telegramNick: true } } },
    });
    await this.prisma.chatMember.update({
      where: { chatId_userId: { chatId, userId: user.id } },
      data: { lastReadAt: new Date() },
    });
    return messages.reverse().map((message) => messageDto(message, user.id));
  }

  async send(user: AuthUser, chatId: string, text: string) {
    await this.member(user.id, chatId);
    const other = await this.prisma.chatMember.findFirst({ where: { chatId, userId: { not: user.id } } });
    if (!other) throw new BadRequestException('В чате нет получателя.');
    await this.assertNotBlocked(user.id, other.userId);
    const message = await this.prisma.message.create({
      data: { chatId, senderId: user.id, text: text.trim() },
      include: { sender: { select: { id: true, onixId: true, displayName: true, telegramNick: true } } },
    });
    await this.prisma.$transaction([
      this.prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }),
      this.prisma.notification.create({
        data: { userId: other.userId, type: 'NEW_MESSAGE', title: 'Новое сообщение', body: text.trim().slice(0, 160), data: { chatId } },
      }),
    ]);
    return messageDto(message, user.id);
  }

  async notifications(user: AuthUser) {
    const items = await this.prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return items.map(notificationDto);
  }
  readNotification(user: AuthUser, id: bigint) {
    return this.prisma.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } });
  }

  async reviews(onixId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { subject: { onixId } },
      include: { author: { select: { id: true, onixId: true, displayName: true, telegramNick: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return reviews.map(reviewDto);
  }

  async review(user: AuthUser, orderId: bigint, dto: ReviewDto) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.status !== 'COMPLETED') throw new BadRequestException('Отзыв доступен только после завершённой сделки.');
      if (order.buyerId !== user.id && order.sellerId !== user.id) throw new NotFoundException('Сделка не найдена.');
      const subjectId = order.buyerId === user.id ? order.sellerId : order.buyerId;
      const review = await tx.review.create({ data: { orderId, authorId: user.id, subjectId, ...dto } });
      const aggregate = await tx.review.aggregate({ where: { subjectId }, _avg: { rating: true }, _count: true });
      await tx.user.update({
        where: { id: subjectId },
        data: { ratingAverage: aggregate._avg.rating ?? 0, ratingCount: aggregate._count },
      });
      await tx.notification.create({
        data: { userId: subjectId, type: 'NEW_REVIEW', title: 'Новый отзыв', body: `Оценка: ${dto.rating}/5`, data: { reviewId: review.id.toString() } },
      });
      const result = await tx.review.findUniqueOrThrow({
        where: { id: review.id },
        include: { author: { select: { id: true, onixId: true, displayName: true, telegramNick: true } } },
      });
      return reviewDto(result);
    });
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

@Controller()
export class EngagementController {
  constructor(private readonly service: EngagementService) {}
  @Get('chats') chats(@CurrentUser() user: AuthUser) { return this.service.chats(user); }
  @Post('chats/direct') direct(@CurrentUser() user: AuthUser, @Body() dto: DirectChatDto) { return this.service.direct(user, dto.onixId); }
  @Get('chats/:id/messages') messages(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.service.messages(user, id, Number(limit) || 50);
  }
  @Post('chats/:id/messages') send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MessageDto) {
    return this.service.send(user, id, dto.text);
  }
  @Get('notifications') notifications(@CurrentUser() user: AuthUser) { return this.service.notifications(user); }
  @Patch('notifications/:id/read') read(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.readNotification(user, parseId(id)); }
  @Get('users/:onixId/reviews') reviews(@Param('onixId') id: string) { return this.service.reviews(id); }
  @Post('orders/:id/reviews') review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.service.review(user, parseId(id), dto);
  }
}

@Module({ controllers: [EngagementController], providers: [EngagementService] })
export class EngagementModule {}
