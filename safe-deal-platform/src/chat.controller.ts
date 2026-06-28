import {
  Controller, Get, Post, Body, HttpCode, HttpStatus,
  BadRequestException, Logger, Query,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

// XSS-санитайзер для входящих сообщений
function sanitize(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

class ApiResponse<T> {
  readonly success = true;
  constructor(public readonly data: T) {}
}

// ВАЖНО: префикс 'chat' (не 'api/chat') — глобальный /api добавит main.ts
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/chat/history?limit=50
   * История глобального чата из PostgreSQL.
   */
  @Get('history')
  async getChatHistory(@Query('limit') limitStr?: string) {
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 100);

    const messages = await this.prisma.globalChat.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    // Возвращаем в хронологическом порядке (старые → новые)
    return new ApiResponse(
      messages.reverse().map((m) => ({
        id: m.id,
        senderId: m.senderId.toString(),
        senderName: m.senderName,
        receiverName: m.receiverName ?? null,
        text: m.text,
        isAdmin: m.isAdmin,
        timestamp: m.timestamp,
      }))
    );
  }

  /**
   * POST /api/chat/send
   * Отправка сообщения в глобальный чат.
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Body('senderTgId') senderTgIdStr: string,
    @Body('text') text: string,
    @Body('receiverName') receiverName?: string,
  ) {
    if (!text || text.trim().length === 0) {
      throw new BadRequestException('Сообщение не может быть пустым.');
    }
    if (text.length > 1000) {
      throw new BadRequestException('Сообщение слишком длинное (макс. 1000 символов).');
    }
    if (!senderTgIdStr || !/^\d+$/.test(senderTgIdStr.trim())) {
      throw new BadRequestException('senderTgId должен быть числовой строкой.');
    }

    try {
      const telegramId = BigInt(senderTgIdStr.trim());
      const user = await this.prisma.user.findUnique({
        where: { telegramId },
        select: { id: true, telegramNick: true },
      });

      const senderName = user?.telegramNick ?? `ACC №${senderTgIdStr}`;
      const nameLower = senderName.toLowerCase();
      const isAdmin = nameLower.includes('max_ceo') || nameLower.includes('shop_rub');

      const message = await this.prisma.globalChat.create({
        data: {
          senderId: telegramId,
          senderName,
          text: sanitize(text),
          receiverName: receiverName ? sanitize(receiverName) : null,
          isAdmin,
        },
      });

      return new ApiResponse({ id: message.id });
    } catch (err) {
      this.logger.error(`[CHAT SEND CRASH]: ${(err as Error).message}`);
      throw new BadRequestException('Ошибка отправки сообщения.');
    }
  }

  /**
   * GET /api/chat/reviews
   * Последние отзывы из PostgreSQL.
   */
  @Get('reviews')
  async getReviews() {
    const reviews = await this.prisma.review.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return new ApiResponse(
      reviews.map((r) => ({
        id: r.id,
        author: r.author,
        text: r.text,
        rating: r.rating,
        createdAt: r.createdAt,
      }))
    );
  }

  /**
   * POST /api/chat/reviews
   * Публикация отзыва.
   */
  @Post('reviews')
  @HttpCode(HttpStatus.CREATED)
  async createReview(
    @Body('authorTgId') authorTgIdStr: string,
    @Body('text') text: string,
    @Body('rating') rating: string,
  ) {
    if (!text || !rating) throw new BadRequestException('Заполните все поля отзыва.');

    const validRatings = ['⭐️', '⭐️⭐️', '⭐️⭐️⭐️', '⭐️⭐️⭐️⭐️', '⭐️⭐️⭐️⭐️⭐️'];
    if (!validRatings.includes(rating.trim())) {
      throw new BadRequestException('Невалидный рейтинг.');
    }

    if (!authorTgIdStr || !/^\d+$/.test(authorTgIdStr.trim())) {
      throw new BadRequestException('authorTgId должен быть числовой строкой.');
    }

    try {
      const telegramId = BigInt(authorTgIdStr.trim());
      const user = await this.prisma.user.findUnique({
        where: { telegramId },
        select: { id: true, telegramNick: true },
      });
      const authorName = user?.telegramNick ?? `ACC №${authorTgIdStr}`;

      const review = await this.prisma.review.create({
        data: {
          authorId: telegramId,
          author: authorName,
          text: sanitize(text),
          rating: rating.trim(),
        },
      });

      return new ApiResponse({
        id: review.id,
        author: review.author,
        text: review.text,
        rating: review.rating,
        createdAt: review.createdAt,
      });
    } catch (err) {
      this.logger.error(`[REVIEW CRASH]: ${(err as Error).message}`);
      throw new BadRequestException('Ошибка публикации отзыва.');
    }
  }
}