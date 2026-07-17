import { Injectable } from '@nestjs/common';
import { AuthUser } from '../common';
import { PrismaService } from '../prisma.service';
import { helpReply } from './help-replies';
import { IntentRecognizer } from './intent-recognizer';
import { ProductCreationService } from './product-creation.service';

const WELCOME = [
  'Я ONIX AI — помощник платформы.',
  '',
  'Выберите тему кнопкой ниже или напишите «Создай товар».',
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
    const pairKey = this.aiPairKey(user.id);
    let chat = await this.prisma.chat.findUnique({ where: { pairKey } });
    if (!chat) {
      chat = await this.prisma.$transaction(async (tx) => {
        const created = await tx.chat.create({
          data: {
            pairKey,
            kind: 'AI',
            title: 'ONIX AI',
            members: { create: { userId: user.id } },
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

    // FAQ quick-replies always answer, even mid product draft.
    if (intent === 'HELP') {
      return helpReply(body);
    }

    if (intent === 'CREATE_PRODUCT') {
      let active = session;
      if (!active || active.status === 'READY') {
        active = await this.products.start(user.id, chatId);
      }
      // Strip create phrase and ingest remainder in one shot
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
      'Я могу создать товар или ответить на базовые вопросы.',
      'Нажмите кнопку ниже или напишите «Создай товар».',
    ].join('\n');
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
