import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../common';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import { LoginChallengeService } from './login-challenge.service';

type TelegramUpdate = {
  message?: {
    text?: string;
    from?: {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    chat?: { id: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    message?: { chat?: { id: number } };
  };
};

/**
 * Telegram Bot webhook — confirms LoginChallenge.
 * Does not touch SessionService; confirmation only. Session is issued on website complete.
 */
@Public()
@Controller('telegram')
export class BotWebhookHandler {
  constructor(private readonly challenges: LoginChallengeService) {}

  @Post('webhook')
  async handle(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: TelegramUpdate,
  ) {
    assertWebhookSecret(secret);

    const start = update.message?.text?.trim();
    if (start?.startsWith('/start ')) {
      const param = start.slice('/start '.length).trim();
      const challengeId = parseLoginChallengeId(param);
      if (!challengeId) return { ok: true };
      await this.challenges.markOpened(challengeId);
      const from = update.message?.from;
      if (!from) return { ok: true };
      // Auto-prompt: send confirm via Bot API (best-effort; tests mock service).
      await sendConfirmPrompt(update.message!.chat!.id, challengeId, from.first_name);
      return { ok: true };
    }

    const data = update.callback_query?.data;
    if (data?.startsWith('confirm_login:')) {
      const challengeId = data.slice('confirm_login:'.length);
      const from = update.callback_query?.from;
      if (!from) return { ok: true };
      const result = await this.challenges.confirmFromBot(challengeId, {
        telegramId: BigInt(from.id),
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
      });
      await sendReturnLink(
        update.callback_query!.message!.chat!.id,
        result.returnUrl,
      );
      return { ok: true, confirmed: true };
    }

    return { ok: true };
  }
}

function parseLoginChallengeId(startParam: string): string | null {
  if (!startParam.startsWith('login_')) return null;
  const id = startParam.slice('login_'.length);
  return id.length > 0 ? id : null;
}

function assertWebhookSecret(secret: string | undefined): void {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return; // allow unset in local/test
  if (secret !== expected) {
    throw new AuthPlatformError('AUTH_PROVIDER_REJECTED', 'Invalid Telegram webhook secret.');
  }
}

async function sendConfirmPrompt(chatId: number, challengeId: string, firstName?: string): Promise<void> {
  const token = process.env.BOT_TOKEN;
  if (!token) return;
  const text = `${firstName ? `${firstName}, ` : ''}подтвердите вход в ONIX.`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [[{ text: 'Подтвердить вход', callback_data: `confirm_login:${challengeId}` }]],
      },
    }),
  }).catch(() => undefined);
}

async function sendReturnLink(chatId: number, returnUrl: string): Promise<void> {
  const token = process.env.BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: 'Вход подтверждён. Если браузер не открылся автоматически — вернитесь в ONIX:',
      reply_markup: {
        inline_keyboard: [[{ text: 'Вернуться в ONIX', url: returnUrl }]],
      },
    }),
  }).catch(() => undefined);
}
