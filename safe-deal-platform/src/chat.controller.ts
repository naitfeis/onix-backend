import { Controller, Get, Post, Body, HttpCode, HttpStatus, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// СЕНИОР-ФАБРИКА ОЧИСТКИ ТЕКСТА: Защита от XSS атак [проф. 1]
class OnixSecuritySanitizer {
  static sanitize(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .trim();
  }
}

// СТАФФ-ИНФРАСТРУКТУРА: Выделяем защищенные RAM-буферы для хранения данных чата и отзывов в памяти [проф. 1]
const MEMORY_CHAT_LOGS: any[] = [
  { id: "init_1", senderId: "0", senderName: "SYSTEM", text: "Глобальный чат ONIX | SSSF успешно запущен в RAM.", timestamp: "12:00", isAdmin: true, receiverName: null }
];

const MEMORY_REVIEWS_LOGS: any[] = [
  { id: "rev_1", author: "@sniper_pro", text: "Все отлично! Голда прилетела за пару минут.", rating: "⭐️⭐️⭐️⭐️⭐️" }
];

@Controller('api')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 🔥 STAFF API: Выгрузка логов Чат-Хаба из RAM [проф. 1]
   */
  @Get('chat/history')
  async getChatHistory() {
    return { success: true, data: MEMORY_CHAT_LOGS };
  }

  /**
   * 🔥 STAFF API: Прием сообщений с авто-очисткой XSS и записью в RAM [проф. 1]
   */
  @Post('chat/send')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Body('senderId') senderIdStr: string,
    @Body('text') text: string,
    @Body('receiverName') receiverName: string | null
  ) {
    if (!text || text.trim() === "") {
      throw new BadRequestException('Строка сообщения не может быть пустой.');
    }

    try {
      const senderId = BigInt(senderIdStr.trim());
      const user = await this.prisma.user.findUnique({ where: { id: senderId } }).catch(() => null);

      const senderName = user?.telegramNick || `ACC №${senderIdStr}`;
      const nameLower = senderName.toLowerCase();
      const isAdmin = nameLower.includes('max_ceo') || nameLower.includes('shop_rub');

      const cleanText = OnixSecuritySanitizer.sanitize(text);

      const newMsg = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        senderId: senderIdStr,
        senderName,
        text: cleanText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isAdmin,
        // ИСПРАВЛЕНО: Переменная receiverName теперь используется в объекте! Ошибка TS6133 полностью уничтожена [проф. 1]
        receiverName: receiverName ? OnixSecuritySanitizer.sanitize(receiverName) : null
      };

      MEMORY_CHAT_LOGS.push(newMsg);

      if (MEMORY_CHAT_LOGS.length > 50) {
        MEMORY_CHAT_LOGS.shift();
      }

      return { success: true, data: { id: newMsg.id } };
    } catch (error: any) {
      this.logger.error(`[🚨 MESSAGE ROUTING ERROR]: ${error.message}`);
      throw new BadRequestException('Ошибка фонового клиринга сообщения.');
    }
  }

  /**
   * 🔥 STAFF API: Выгрузка отзывов из RAM [проф. 1]
   */
  @Get('reviews')
  async getReviews() {
    return { success: true, data: MEMORY_REVIEWS_LOGS };
  }

  /**
   * 🔥 STAFF API: Пуш отзыва в RAM с валидацией рейтинговой сетки [проф. 1]
   */
  @Post('reviews/create')
  async createReview(
    @Body('authorId') authorIdStr: string,
    @Body('text') text: string,
    @Body('rating') rating: string
  ) {
    if (!text || !rating) throw new BadRequestException('Все поля формы обязательны.');

    const validRatings = ["⭐️⭐️⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️", "⭐️⭐️⭐️", "⭐️⭐️", "⭐️"];
    if (!validRatings.includes(rating.trim())) {
      throw new BadRequestException('Невалидный маркер звезд.');
    }

    try {
      const authorId = BigInt(authorIdStr.trim());
      const user = await this.prisma.user.findUnique({ where: { id: authorId } }).catch(() => null);
      const authorName = user?.telegramNick || `ACC №${authorIdStr}`;

      const newReview = {
        id: Date.now(),
        author: authorName,
        text: OnixSecuritySanitizer.sanitize(text),
        rating: rating.trim()
      };

      MEMORY_REVIEWS_LOGS.unshift(newReview);
      if (MEMORY_REVIEWS_LOGS.length > 20) MEMORY_REVIEWS_LOGS.pop();

      return { success: true, data: newReview };
    } catch (error: any) {
      this.logger.error(`[🚨 REVIEW INJECTION CRASH]: ${error.message}`);
      throw new BadRequestException('Не удалось зафиксировать отзыв.');
    }
  }
}