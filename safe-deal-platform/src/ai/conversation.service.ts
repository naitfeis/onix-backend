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
import { ProductCreationService } from './product-creation.service';

const WELCOME = [
  'Я ONIX AI — помощник площадки ONIX.',
  '',
  'Нажмите «О площадке ONIX», «Создай товар» или «Написать в поддержку».',
  'Также: гарант · вывод · ONIXLOT-id лота в любом чате.',
].join('\n');

@Injectable()
export class ConversationService {
  private readonly intents = new IntentRecognizer();

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductCreationService,
  ) {}

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
    const session = await this.products.getActive(user.id, chatId);
    const intent = this.intents.recognize(body, { sessionReady: session?.status === 'READY' });

    if (intent === 'FUTURE') {
      return 'Эта функция появится позже.';
    }

    if (intent === 'CANCEL' && session) {
      await this.products.cancel(session.id);
      return 'Создание товара отменено. Напишите «Создай товар», когда будете готовы.';
    }

    if (intent === 'CONTACT_SUPPORT') {
      const remainder = supportMessageBody(body);
      if (!remainder) return SUPPORT_AWAIT_PROMPT;
      return this.submitAiSupport(user, remainder);
    }

    if (!session && await this.isAwaitingSupport(chatId) && intent !== 'HELP' && intent !== 'CREATE_PRODUCT') {
      return this.submitAiSupport(user, body);
    }

    // FAQ quick-replies always answer, even mid product draft.
    if (intent === 'HELP') {
      return helpReply(body);
    }

    if (intent === 'CREATE_PRODUCT') {
      let active = session;
      if (!active || active.status === 'READY') {
        active = await this.products.start(user.id, chatId);
      }
      const remainder = body
        .replace(/^(создай\s+(новый\s+)?товар|новый\s+товар|создать\s+(новый\s+)?товар|добавить\s+товар)\s*/i, '')
        .trim();
      if (remainder) {
        active = await this.products.ingestMessage(active, remainder);
      }
      if (active.status === 'READY') {
        return this.products.formatCard(active);
      }
      if (remainder && active.status !== 'WAIT_TITLE') {
        return this.products.promptFor(active.status, active);
      }
      return [
        'Хорошо, создаём товар.',
        this.products.promptFor(active.status, active),
      ].join('\n\n');
    }

    if (session?.status === 'READY') {
      if (intent === 'PUBLISH_PRODUCT') {
        try {
          const published = await this.products.publish(user, session);
          return published.message;
        } catch (error) {
          return error instanceof Error ? error.message : 'Не удалось опубликовать товар.';
        }
      }
      if (intent === 'EDIT_PRODUCT') {
        await this.products.resetForEdit(session);
        return 'Хорошо, заполним заново.\n\nКак называется товар? (от 5 до 32 символов)';
      }
      return 'Напишите «Опубликовать» или «Изменить».';
    }

    if (session && session.status !== 'FINISHED') {
      const shortTitle = session.status === 'WAIT_TITLE'
        && body.length > 0
        && body.length < 5
        && !body.includes('\n');
      const updated = await this.products.ingestMessage(session, body);
      if (shortTitle && updated.status === 'WAIT_TITLE' && (updated.title?.length ?? 0) < 5) {
        return 'Название слишком короткое — нужно от 5 до 32 символов. Напишите название ещё раз.';
      }
      if (updated.status === session.status && !this.progressed(session, updated)) {
        return `Не удалось распознать. ${this.products.promptFor(session.status, session)}`;
      }
      if (updated.status === 'READY') return this.products.formatCard(updated);
      return this.products.promptFor(updated.status, updated);
    }

    return [
      'Я могу создать товар, ответить на вопросы или передать обращение в поддержку.',
      'Нажмите кнопку ниже или напишите «Создай товар» / «Написать в поддержку».',
    ].join('\n');
  }

  /** Create AI_SUPPORT report in жалобы inbox + notify admin Telegram. */
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
        `От (ONIX AI):`,
        formatOnixId(user.onixId),
        '',
        `Сообщение:`,
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

  private progressed(
    before: { title: string | null; category: unknown; subcategory: unknown; priceCents: unknown; quantity: unknown; description: string | null },
    after: { title: string | null; category: unknown; subcategory: unknown; priceCents: unknown; quantity: unknown; description: string | null },
  ) {
    return before.title !== after.title
      || before.category !== after.category
      || before.subcategory !== after.subcategory
      || before.priceCents !== after.priceCents
      || before.quantity !== after.quantity
      || before.description !== after.description;
  }
}
