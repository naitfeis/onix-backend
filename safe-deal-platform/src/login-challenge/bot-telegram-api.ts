/**
 * Minimal Telegram Bot API helpers for LoginChallenge UX.
 * Best-effort: failures never break webhook ACK.
 */

export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
};

async function telegramApi(method: string, body: Record<string, unknown>): Promise<boolean> {
  const token = process.env.BOT_TOKEN;
  if (!token) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function sendTelegramMessage(input: {
  chatId: number;
  text: string;
  parseMode?: 'HTML';
  replyMarkup?: InlineKeyboard;
}): Promise<boolean> {
  return telegramApi('sendMessage', {
    chat_id: input.chatId,
    text: input.text,
    ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
    ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
    disable_web_page_preview: true,
  });
}

export async function editTelegramMessage(input: {
  chatId: number;
  messageId: number;
  text: string;
  parseMode?: 'HTML';
  replyMarkup?: InlineKeyboard | { inline_keyboard: [] };
}): Promise<boolean> {
  return telegramApi('editMessageText', {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text,
    ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
    reply_markup: input.replyMarkup ?? { inline_keyboard: [] },
    disable_web_page_preview: true,
  });
}

export async function answerTelegramCallback(
  callbackQueryId: string,
  text?: string,
): Promise<boolean> {
  return telegramApi('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}
