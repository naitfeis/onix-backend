import type { NotificationType, Prisma } from '@prisma/client';
import { sendTelegramMessage, type InlineKeyboard } from './login-challenge/bot-telegram-api';
import type { PrismaService } from './prisma.service';

type NotificationDb = Pick<PrismaService, 'notification'>;

/**
 * Persist in-app notification (source of truth for the Telegram outbox).
 * Telegram is delivered after commit via tryDeliverNotification / worker drain.
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
      title: input.title.slice(0, 160),
      body: input.body.slice(0, 500),
      ...(input.data !== undefined ? { data: input.data } : {}),
    },
    select: { id: true },
  });
}

export function notificationOrderId(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const orderId = (data as { orderId?: unknown }).orderId;
  return typeof orderId === 'string' ? orderId : null;
}

export function notificationChatId(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const chatId = (data as { chatId?: unknown }).chatId;
  return typeof chatId === 'string' && chatId ? chatId : null;
}

/**
 * After-commit / worker: send Telegram once, then stamp telegramPushedAt.
 * Never throws — caller treats 'failed' as retry-later.
 */
export async function tryDeliverNotification(
  db: NotificationDb,
  notificationId: bigint,
): Promise<'delivered' | 'skipped' | 'failed'> {
  const row = await db.notification.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      title: true,
      body: true,
      telegramPushedAt: true,
      user: { select: { telegramId: true } },
    },
  });
  if (!row || row.telegramPushedAt) return 'skipped';
  if (row.user.telegramId == null) {
    await db.notification.updateMany({
      where: { id: row.id, telegramPushedAt: null },
      data: { telegramPushedAt: new Date() },
    });
    return 'skipped';
  }
  const result = await sendTelegramMessage({
    chatId: Number(row.user.telegramId),
    text: `<b>${escapeHtml(row.title)}</b>\n${escapeHtml(row.body)}`,
    parseMode: 'HTML',
  });
  if (!result.ok) return 'failed';
  await db.notification.updateMany({
    where: { id: row.id, telegramPushedAt: null },
    data: { telegramPushedAt: new Date() },
  });
  return 'delivered';
}

/** Fire-and-forget after COMMIT. Crash before this is recovered by the worker. */
export function deliverTelegramAfterCommit(
  db: NotificationDb,
  ids: readonly bigint[],
): void {
  for (const id of ids) {
    void tryDeliverNotification(db, id);
  }
}

/**
 * Best-effort Telegram that is NOT backed by a Notification row
 * (admin alerts, follower fan-out). Prefer createDomainNotification + after-commit
 * for user-facing domain events.
 */
export async function pushTelegramToChatId(
  telegramId: bigint | null | undefined,
  title: string,
  body: string,
  replyMarkup?: InlineKeyboard,
): Promise<void> {
  if (telegramId == null) return;
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
  followers: Array<{ telegramId: bigint | null }>,
  product: { id: string; title: string; priceCents: bigint; category: string },
): Promise<void> {
  const appBase = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',')[0]?.trim();
  const openUrl = appBase ? `${appBase.replace(/\/$/, '')}/?product=${encodeURIComponent(product.id)}` : undefined;
  const priceRub = formatRubFromCents(product.priceCents);
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

function formatRubFromCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const rub = abs / 100n;
  const kop = abs % 100n;
  return `${neg ? '-' : ''}${rub.toString()}.${kop.toString().padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
