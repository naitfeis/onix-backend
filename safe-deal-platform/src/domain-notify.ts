import type { NotificationType, Prisma } from '@prisma/client';
import { sendTelegramMessage, type InlineKeyboard } from './login-challenge/bot-telegram-api';

/**
 * Persist in-app notification (kept for history/analytics).
 * Telegram push is separate (after commit) via pushTelegramToChatId.
 */
export async function createDomainNotification(
  db: { notification: { create: Prisma.TransactionClient['notification']['create'] } },
  input: {
    userId: bigint;
    type: NotificationType;
    title: string;
    body: string;
    data?: Prisma.InputJsonValue;
  },
): Promise<{ id: bigint }> {
  return db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      ...(input.data !== undefined ? { data: input.data } : {}),
    },
    select: { id: true },
  });
}

/** Best-effort Telegram Bot push — never throws to domain callers. */
export async function pushTelegramToChatId(
  telegramId: bigint,
  title: string,
  body: string,
  replyMarkup?: InlineKeyboard,
): Promise<void> {
  try {
    await sendTelegramMessage({
      chatId: Number(telegramId),
      text: `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`,
      parseMode: 'HTML',
      ...(replyMarkup ? { replyMarkup } : {}),
    });
  } catch {
    /* ignore */
  }
}

/** Notify seller followers about a newly published ACTIVE product (Bot API, no polling). */
export async function pushNewProductToFollowers(
  followers: Array<{ telegramId: bigint }>,
  product: { id: string; title: string; priceCents: bigint; category: string },
): Promise<void> {
  const appBase = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',')[0]?.trim();
  const openUrl = appBase ? `${appBase.replace(/\/$/, '')}/?product=${encodeURIComponent(product.id)}` : undefined;
  const priceRub = (Number(product.priceCents) / 100).toFixed(2);
  const body = [
    product.title,
    `Цена: ${priceRub} ₽`,
    `Категория: ${product.category}`,
  ].join('\n');
  const replyMarkup: InlineKeyboard | undefined = openUrl
    ? { inline_keyboard: [[{ text: 'Открыть', url: openUrl }]] }
    : undefined;
  await Promise.allSettled(
    followers.map((f) => pushTelegramToChatId(f.telegramId, 'Новый товар у продавца', body, replyMarkup)),
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
