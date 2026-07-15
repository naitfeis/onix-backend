import type { NotificationType, Prisma } from '@prisma/client';
import { sendTelegramMessage } from './login-challenge/bot-telegram-api';

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
export async function pushTelegramToChatId(telegramId: bigint, title: string, body: string): Promise<void> {
  try {
    await sendTelegramMessage({
      chatId: Number(telegramId),
      text: `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`,
      parseMode: 'HTML',
    });
  } catch {
    /* ignore */
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
