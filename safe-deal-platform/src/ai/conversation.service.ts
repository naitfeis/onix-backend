import { Injectable } from '@nestjs/common';
import { AuthUser } from '../common';
import { pushTelegramToChatId } from '../domain-notify';
import { formatOnixId } from '../onix-id';
import { PrismaService } from '../prisma.service';
import { assertRateLimit } from '../rate-limit';
import { helpReply } from './help-replies';
import {
  IntentRecognizer,
  SUPPORT_AWAIT_PROMPT,
  supportMessageBody,
} from './intent-recognizer';

const WELCOME = [
  'Я ONIX AI — помощник площадки ONIX.',
  '',
  'Отвечу на вопросы о площадке или передам обращение в поддержку.',
  'Создать товар и вывести средства можно в соответствующих разделах приложения.',
].join('\n');

@Injectable()
export class ConversationService {
  private readonly intents = new IntentRecognizer();

  constructor(private readonly prisma: PrismaService) {}

  aiPairKey(userId: bigint) {
    return `ai:${userId.toString()}`;
  }

  async ensureAiChat(user: AuthUser) {
    return this.ensureAiChatForUserId(user.id);
  }

  async ensureAiChatForUserId(userId: bigint) {
    const pairKey = this.aiPairKey(userId);
    let chat = await this.prisma.chat.findUnique({ where: { pairKey } });
    if (!chat) {
      chat = await this.prisma.$transaction(async (tx) => {
        const created = await tx.chat.create({
          data: {
            pairKey,
            kind: 'AI',
            title: 'ONIX AI',
            members: { create: { userId } },
          },
        });
        await tx.message.create({
          data: {
            chatId: created.id,
            kind: 'SYSTEM',
            senderId: null,
            text: WELCOME,
          },
        });
        return created;
      });
    } else if (chat.kind !== 'AI' || chat.title !== 'ONIX AI') {
      chat = await this.prisma.chat.update({
        where: { id: chat.id },
        data: { kind: 'AI', title: 'ONIX AI' },
      });
    }
    return chat;
  }

  async handleUserMessage(user: AuthUser, chatId: string, text: string): Promise<string> {
    const body = text.trim();
    const intent = this.intents.recognize(body);

    if (intent === 'CONTACT_SUPPORT') {
      const remainder = supportMessageBody(body);
      if (!remainder) return SUPPORT_AWAIT_PROMPT;
      return this.submitAiSupport(user, remainder);
    }

    if (await this.isAwaitingSupport(chatId)) {
      return this.submitAiSupport(user, body);
    }

    if (intent === 'HELP') {
      return helpReply(body);
    }

    return [
      'Я могу ответить на вопросы об ONIX или передать обращение в поддержку.',
      'Для создания товара откройте вкладку «Лот».',
      'Для вывода средств откройте «Профиль → Баланс → Вывести».',
    ].join('\n');
  }

  /** Create AI_SUPPORT report in the secure admin support inbox. */
  async submitAiSupport(user: AuthUser, message: string): Promise<string> {
    const text = message.trim().slice(0, 1000);
    if (text.length < 3) {
      return 'Напишите чуть подробнее — минимум несколько слов.';
    }
    try {
      assertRateLimit(`ai-support:${user.id}`, 5, 60 * 60_000);
    } catch {
      return 'Слишком много обращений. Подождите немного и попробуйте снова.';
    }

    const report = await this.prisma.userReport.create({
      data: {
        reporterId: user.id,
        targetId: user.id,
        reason: 'OTHER',
        comment: text,
        kind: 'AI_SUPPORT',
      },
    });

    const adminTg = process.env.ADMIN_TELEGRAM_ID?.trim();
    if (adminTg && /^\d+$/.test(adminTg)) {
      const body = [
        'От (ONIX AI):',
        formatOnixId(user.onixId),
        '',
        'Сообщение:',
        text,
        '',
        `ID: ${report.id}`,
      ].join('\n');
      void pushTelegramToChatId(BigInt(adminTg), '🆘 Обращение в поддержку (AI)', body);
    }

    return [
      '✅ Обращение отправлено в поддержку ONIX.',
      'Ответ придёт сюда, в этот чат с ONIX AI.',
    ].join('\n');
  }

  private async isAwaitingSupport(chatId: string): Promise<boolean> {
    const last = await this.prisma.message.findFirst({
      where: { chatId, kind: 'SYSTEM', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { text: true },
    });
    return Boolean(last?.text?.includes('Опишите проблему одним сообщением'));
  }
}
