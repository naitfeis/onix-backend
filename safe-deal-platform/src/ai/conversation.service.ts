import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../common';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import { pushTelegramToChatId } from '../domain-notify';
import { BalanceService } from '../economy/wallet/balance.service';
import { resolveCorrelationId } from '../economy/wallet/correlation-id';
import { WithdrawVelocityService } from '../economy/wallet/withdraw-velocity';
import { formatOnixId } from '../onix-id';
import { createId } from '../economy/wallet/cuid';
import { PrismaService } from '../prisma.service';
import { assertRateLimit } from '../rate-limit';
import { RiskEngineService } from '../risk/risk-engine.service';
import { helpReply } from './help-replies';
import {
  IntentRecognizer,
  SUPPORT_AWAIT_PROMPT,
  WITHDRAW_AMOUNT_PROMPT,
  WITHDRAW_CARD_PROMPT,
  WITHDRAW_METHOD_PROMPT,
  supportMessageBody,
} from './intent-recognizer';
import { ProductCreationService } from './product-creation.service';

const WELCOME = [
  'Я ONIX AI — помощник площадки ONIX.',
  '',
  'Могу создать товар, вывести деньги или передать обращение в поддержку.',
  'Пример: «создай товар PUBG за 500 ₽, 10 штук»',
].join('\n');

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

type WithdrawStep = 'AMOUNT' | 'METHOD' | 'CARD';

@Injectable()
export class ConversationService {
  private readonly intents = new IntentRecognizer();

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductCreationService,
    private readonly balance: BalanceService,
    private readonly riskEngine: RiskEngineService,
    private readonly withdrawVelocity: WithdrawVelocityService,
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
    const withdrawStep = await this.detectWithdrawStep(chatId);

    if (intent === 'FUTURE') {
      return 'Эта функция появится позже.';
    }

    if (intent === 'CANCEL') {
      if (session) {
        await this.products.cancel(session.id);
        return 'Создание товара отменено. Напишите «Создай товар», когда будете готовы.';
      }
      if (withdrawStep) {
        return 'Вывод отменён. Напишите «Вывести деньги», чтобы начать снова.';
      }
      return 'Нечего отменять. Чем помочь?';
    }

    if (intent === 'WITHDRAW') {
      return WITHDRAW_AMOUNT_PROMPT;
    }

    if (withdrawStep && !session && intent !== 'CREATE_PRODUCT' && intent !== 'CONTACT_SUPPORT' && intent !== 'HELP') {
      return this.continueWithdraw(user, chatId, body, withdrawStep);
    }

    if (intent === 'CONTACT_SUPPORT') {
      const remainder = supportMessageBody(body);
      if (!remainder) return SUPPORT_AWAIT_PROMPT;
      return this.submitAiSupport(user, remainder);
    }

    if (!session && await this.isAwaitingSupport(chatId) && intent !== 'HELP' && intent !== 'CREATE_PRODUCT') {
      return this.submitAiSupport(user, body);
    }

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
        return this.publishOrCard(user, active);
      }
      if (remainder && active.status !== 'WAIT_TITLE') {
        return [
          'Принял данные. Нужно уточнить ещё:',
          this.products.promptFor(active.status, active),
        ].join('\n\n');
      }
      return [
        'Хорошо, создаём товар.',
        this.products.promptFor(active.status, active),
      ].join('\n\n');
    }

    if (session?.status === 'READY') {
      if (intent === 'PUBLISH_PRODUCT') {
        return this.publishOrCard(user, session);
      }
      if (intent === 'EDIT_PRODUCT') {
        await this.products.resetForEdit(session);
        return 'Хорошо, заполним заново.\n\nКак называется товар? (от 5 до 32 символов)';
      }
      // Auto-publish if user confirms with anything short positive
      if (/^(да|ок|окей|публикуй|публиковать)$/i.test(body)) {
        return this.publishOrCard(user, session);
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
      if (updated.status === 'READY') {
        return this.publishOrCard(user, updated);
      }
      return this.products.promptFor(updated.status, updated);
    }

    return [
      'Я могу создать товар, вывести деньги или передать обращение в поддержку.',
      'Пример: «создай товар PUBG за 500 ₽, 10 штук»',
      'Или нажмите кнопку ниже.',
    ].join('\n');
  }

  private async publishOrCard(user: AuthUser, session: {
    id: string;
    title: string | null;
    category: import('@prisma/client').ProductCategory | null;
    subcategory: import('@prisma/client').ProductSubcategory | null;
    priceCents: bigint | null;
    quantity: number | null;
    description: string | null;
    status: import('@prisma/client').ProductCreationStatus;
    productId: string | null;
  }): Promise<string> {
    try {
      const published = await this.products.publish(user, session);
      return published.message;
    } catch (error) {
      const hint = error instanceof Error ? error.message : 'Не удалось опубликовать товар.';
      return `${hint}\n\n${this.products.formatCard(session)}`;
    }
  }

  private async detectWithdrawStep(chatId: string): Promise<WithdrawStep | null> {
    const last = await this.prisma.message.findFirst({
      where: { chatId, kind: 'SYSTEM', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { text: true },
    });
    const t = last?.text ?? '';
    if (t.includes('Введите реквизиты')) return 'CARD';
    if (t.includes('Укажите способ вывода')) return 'METHOD';
    if (t.includes('Введите сумму вывода')) return 'AMOUNT';
    return null;
  }

  private async continueWithdraw(
    user: AuthUser,
    chatId: string,
    body: string,
    step: WithdrawStep,
  ): Promise<string> {
    if (step === 'AMOUNT') {
      const rubles = this.parseWithdrawAmount(body);
      if (rubles == null) {
        return `Не распознал сумму.\n\n${WITHDRAW_AMOUNT_PROMPT}`;
      }
      return [
        `Сумма вывода: ${rubles} ₽`,
        '',
        WITHDRAW_METHOD_PROMPT,
      ].join('\n');
    }

    if (step === 'METHOD') {
      const method = this.parseWithdrawMethod(body);
      if (!method) {
        return `Укажите один из способов.\n\n${WITHDRAW_METHOD_PROMPT}`;
      }
      const amount = await this.readWithdrawAmountFromChat(chatId);
      if (amount == null) return WITHDRAW_AMOUNT_PROMPT;
      return [
        `Сумма вывода: ${amount} ₽`,
        `Способ: ${method}`,
        '',
        WITHDRAW_CARD_PROMPT,
      ].join('\n');
    }

    // CARD
    const destination = body.trim().slice(0, 120);
    if (destination.length < 4) {
      return `Реквизиты слишком короткие.\n\n${WITHDRAW_CARD_PROMPT}`;
    }
    const amount = await this.readWithdrawAmountFromChat(chatId);
    const method = await this.readWithdrawMethodFromChat(chatId);
    if (amount == null) return WITHDRAW_AMOUNT_PROMPT;
    if (!method) return WITHDRAW_METHOD_PROMPT;
    return this.submitWithdrawal(user, amount, method, destination);
  }

  private parseWithdrawAmount(text: string): number | null {
    const m = text.replace(/\s/g, '').match(/(\d+(?:[.,]\d{1,2})?)/);
    if (!m) return null;
    const n = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(n) || n < 1 || n > 50_000_000) return null;
    return Math.round(n * 100) / 100;
  }

  private parseWithdrawMethod(text: string): string | null {
    const t = text.trim().toLowerCase();
    if (/карт|card|visa|mir|мир/.test(t)) return 'карта';
    if (/сбп|sbp|телефон|phone/.test(t)) return 'СБП';
    if (/крипт|crypto|usdt|btc|eth/.test(t)) return 'крипто';
    return null;
  }

  private async readWithdrawAmountFromChat(chatId: string): Promise<number | null> {
    const rows = await this.prisma.message.findMany({
      where: { chatId, kind: 'SYSTEM', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { text: true },
    });
    for (const row of rows) {
      const m = row.text.match(/Сумма вывода:\s*(\d+(?:[.,]\d{1,2})?)/i);
      if (m) return this.parseWithdrawAmount(m[1]!);
    }
    return null;
  }

  private async readWithdrawMethodFromChat(chatId: string): Promise<string | null> {
    const rows = await this.prisma.message.findMany({
      where: { chatId, kind: 'SYSTEM', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { text: true },
    });
    for (const row of rows) {
      const m = row.text.match(/Способ:\s*(карта|СБП|крипто)/i);
      if (m) return m[1]!.toLowerCase() === 'сбп' ? 'СБП' : m[1]!.toLowerCase() === 'крипто' ? 'крипто' : 'карта';
    }
    return null;
  }

  private async submitWithdrawal(
    user: AuthUser,
    amountRubles: number,
    method: string,
    destination: string,
  ): Promise<string> {
    try {
      assertRateLimit(`ai-withdraw:${user.id}`, 5, 60 * 60_000);
    } catch {
      return 'Слишком много заявок на вывод. Подождите немного.';
    }

    const amountCents = BigInt(Math.round(amountRubles * 100));
    if (amountCents < 100n) return 'Минимальная сумма вывода — 1 ₽.';

    try {
      await this.withdrawVelocity.assertAllowed({
        userId: user.id,
        amountCents,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        return error.message;
      }
      throw error;
    }

    try {
      await this.riskEngine.assertWithdrawAllowed({
        userId: user.id,
        amountCents,
        sessionId: user.sessionId,
        payoutDestination: destination,
      });
    } catch (error) {
      if (error instanceof AuthPlatformError && error.code === 'AUTH_STEP_UP_REQUIRED') {
        const details = error.details as {
          webDeepLink?: string;
          challengeId?: string;
          delivery?: string;
        } | undefined;
        const link = details?.webDeepLink;
        if (link) {
          return [
            'Для этого вывода нужно подтверждение в Telegram.',
            `Откройте бота: ${link}`,
            'Нажмите «Подтвердить», затем напишите сюда «подтвердил» или повторите вывод.',
            details?.challengeId ? `(код: ${details.challengeId})` : '',
          ].filter(Boolean).join('\n');
        }
        return 'Для этого вывода нужно подтверждение в Telegram. Откройте бота ONIX, подтвердите вывод и повторите запрос.';
      }
      throw error;
    }

    const enabled = (process.env.WITHDRAWALS_ENABLED ?? '').trim().toLowerCase();
    const railOn = enabled === '1' || enabled === 'true' || enabled === 'yes';
    const idempotencyKey = `ai-wd-${user.id}-${createId()}`.slice(0, 100);
    const corr = resolveCorrelationId();

    try {
      await this.prisma.$transaction(async (tx) => {
        if (railOn) {
          const entry = await this.balance.debit(tx, user.id, amountCents, 'WITHDRAWAL', {
            idempotencyKey,
            description: `Вывод через ONIX AI (${method})`,
            actorUserId: user.id,
            source: 'AI',
            correlationId: corr,
          });
          await tx.auditLog.create({
            data: {
              actorId: user.id,
              action: 'WALLET_WITHDRAWAL_REQUEST',
              entity: 'LedgerEntry',
              entityId: entry.id.toString(),
              metadata: {
                amountCents: amountCents.toString(),
                method,
                destination: destination.slice(0, 120),
                destinationHash: createHash('sha256').update(destination.trim().toLowerCase()).digest('hex').slice(0, 64),
                source: 'ONIX_AI',
                idempotencyKey,
                correlationId: corr,
              },
            },
          });
        } else {
          await tx.auditLog.create({
            data: {
              actorId: user.id,
              action: 'WALLET_WITHDRAWAL_REQUEST',
              entity: 'User',
              entityId: user.id.toString(),
              metadata: {
                amountCents: amountCents.toString(),
                method,
                destination: destination.slice(0, 120),
                destinationHash: createHash('sha256').update(destination.trim().toLowerCase()).digest('hex').slice(0, 64),
                source: 'ONIX_AI',
                pendingManual: true,
                idempotencyKey,
                correlationId: corr,
              },
            },
          });
        }
      }, SERIALIZABLE);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Не удалось создать заявку на вывод.';
      if (/insufficient|недостаточ|balance/i.test(msg)) {
        return 'Недостаточно средств на балансе для вывода.';
      }
      return msg.length < 200 ? msg : 'Не удалось создать заявку на вывод. Проверьте баланс.';
    }

    const adminTg = process.env.ADMIN_TELEGRAM_ID?.trim();
    if (adminTg && /^\d+$/.test(adminTg)) {
      void pushTelegramToChatId(
        BigInt(adminTg),
        '💸 Заявка на вывод (ONIX AI)',
        [
          `От: ${formatOnixId(user.onixId)}`,
          `Сумма: ${amountRubles} ₽`,
          `Способ: ${method}`,
          `Реквизиты: ${destination}`,
          railOn ? 'Статус: списано с баланса' : 'Статус: ожидает ручной обработки',
        ].join('\n'),
      );
    }

    return [
      '✅ Заявка на вывод оформлена.',
      '',
      `Сумма: ${amountRubles} ₽`,
      `Способ: ${method}`,
      `Реквизиты: ${destination}`,
      '',
      railOn
        ? 'Сумма списана с баланса. Обычно зачисление занимает до 24 часов.'
        : 'Заявка передана в обработку. Обычно до 24 часов в рабочие дни.',
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
