/**
 * Minimal Telegram Bot API helpers for LoginChallenge UX.
 * Failures are logged; callers must treat ok=false as a broken chain link.
 */

export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
};

export type TelegramApiResult = {
  ok: boolean;
  method: string;
  botTokenConfigured: boolean;
  statusCode?: number;
  description?: string;
  messageId?: number;
  errorCode?: number;
};

async function telegramApi(method: string, body: Record<string, unknown>): Promise<TelegramApiResult> {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    return {
      ok: false,
      method,
      botTokenConfigured: false,
      description: 'BOT_TOKEN is not configured',
    };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let payload: {
      ok?: boolean;
      description?: string;
      error_code?: number;
      result?: { message_id?: number };
    } = {};
    try {
      payload = await response.json() as typeof payload;
    } catch {
      payload = {};
    }

    const ok = response.ok && payload.ok !== false;
    return {
      ok,
      method,
      botTokenConfigured: true,
      statusCode: response.status,
      description: payload.description,
      errorCode: payload.error_code,
      messageId: payload.result?.message_id,
    };
  } catch (error) {
    return {
      ok: false,
      method,
      botTokenConfigured: true,
      description: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function sendTelegramMessage(input: {
  chatId: number;
  text: string;
  parseMode?: 'HTML';
  replyMarkup?: InlineKeyboard;
}): Promise<TelegramApiResult> {
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
}): Promise<TelegramApiResult> {
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
): Promise<TelegramApiResult> {
  return telegramApi('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}
