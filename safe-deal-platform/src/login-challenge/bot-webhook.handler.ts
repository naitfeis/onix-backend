import { Body, Controller, Headers, Logger, Post } from '@nestjs/common';
import { Public } from '../common';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import {
  answerTelegramCallback,
  editTelegramMessage,
  sendTelegramMessage,
} from './bot-telegram-api';
import { formatLoginConfirmPrompt } from './login-challenge-prompt';
import { LoginChallengeService } from './login-challenge.service';

type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramUpdate = {
  message?: {
    text?: string;
    from?: TelegramUser;
    chat?: { id: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: TelegramUser;
    message?: {
      message_id?: number;
      chat?: { id: number };
      text?: string;
    };
  };
};

/**
 * Telegram Bot webhook — LoginChallenge UX only.
 * Confirm calls existing LoginChallengeService.confirmFromBot.
 * Session is issued later by Website complete (unchanged).
 */
@Public()
@Controller('telegram')
export class BotWebhookHandler {
  private readonly logger = new Logger(BotWebhookHandler.name);

  constructor(private readonly challenges: LoginChallengeService) {}

  @Post('webhook')
  async handle(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: TelegramUpdate,
  ) {
    assertWebhookSecret(secret);

    const start = update.message?.text?.trim();
    if (start?.startsWith('/start ')) {
      return this.onStartLogin(update);
    }

    const data = update.callback_query?.data;
    if (data?.startsWith('confirm_login:')) {
      return this.onConfirm(update, data.slice('confirm_login:'.length));
    }
    if (data?.startsWith('cancel_login:')) {
      return this.onCancel(update, data.slice('cancel_login:'.length));
    }

    return { ok: true };
  }

  private async onStartLogin(update: TelegramUpdate) {
    const start = update.message?.text?.trim() ?? '';
    const param = start.slice('/start '.length).trim();
    const challengeId = parseLoginChallengeId(param);
    const chatId = update.message?.chat?.id;
    const from = update.message?.from;
    if (!challengeId || chatId == null || !from) {
      return { ok: true };
    }

    try {
      const prompt = await this.challenges.openForBotPrompt(challengeId);
      const text = formatLoginConfirmPrompt(
        {
          createdAt: prompt.createdAt,
          createdIp: prompt.createdIp,
          createdUserAgent: prompt.createdUserAgent,
        },
        from.first_name,
      );
      await sendTelegramMessage({
        chatId,
        text,
        parseMode: 'HTML',
        replyMarkup: {
          inline_keyboard: [[
            { text: '✅ Подтвердить вход', callback_data: `confirm_login:${challengeId}` },
            { text: '❌ Отменить', callback_data: `cancel_login:${challengeId}` },
          ]],
        },
      });
      return { ok: true, prompted: true };
    } catch (error) {
      const message = error instanceof AuthPlatformError
        ? userFacingChallengeError(error)
        : 'Не удалось найти попытку входа. Откройте вход на сайте ONIX ещё раз.';
      await sendTelegramMessage({ chatId, text: message });
      this.logger.warn(JSON.stringify({
        msg: 'login_challenge_start_prompt_failed',
        challengeId,
        error: error instanceof Error ? error.message : String(error),
      }));
      return { ok: true, prompted: false };
    }
  }

  private async onConfirm(update: TelegramUpdate, challengeId: string) {
    const cb = update.callback_query;
    const from = cb?.from;
    const chatId = cb?.message?.chat?.id;
    const messageId = cb?.message?.message_id;
    if (!from || chatId == null) {
      return { ok: true };
    }

    if (cb?.id) {
      await answerTelegramCallback(cb.id);
    }

    try {
      const result = await this.challenges.confirmFromBot(challengeId, {
        telegramId: BigInt(from.id),
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
      });

      const confirmedText = [
        '✅ <b>Вход успешно подтверждён</b>',
        '',
        'Вернитесь на сайт ONIX — авторизация завершится автоматически.',
        'Если страница не обновилась, нажмите кнопку ниже.',
      ].join('\n');

      if (messageId != null) {
        await editTelegramMessage({
          chatId,
          messageId,
          text: confirmedText,
          parseMode: 'HTML',
          replyMarkup: {
            inline_keyboard: [[{ text: 'Вернуться в ONIX', url: result.returnUrl }]],
          },
        });
      } else {
        await sendTelegramMessage({
          chatId,
          text: confirmedText,
          parseMode: 'HTML',
          replyMarkup: {
            inline_keyboard: [[{ text: 'Вернуться в ONIX', url: result.returnUrl }]],
          },
        });
      }

      return { ok: true, confirmed: true };
    } catch (error) {
      const text = error instanceof AuthPlatformError
        ? userFacingChallengeError(error)
        : 'Не удалось подтвердить вход. Попробуйте снова с сайта.';
      if (messageId != null) {
        await editTelegramMessage({ chatId, messageId, text, replyMarkup: { inline_keyboard: [] } });
      } else {
        await sendTelegramMessage({ chatId, text });
      }
      return { ok: true, confirmed: false };
    }
  }

  private async onCancel(update: TelegramUpdate, challengeId: string) {
    const cb = update.callback_query;
    const chatId = cb?.message?.chat?.id;
    const messageId = cb?.message?.message_id;
    if (chatId == null) {
      return { ok: true };
    }

    if (cb?.id) {
      await answerTelegramCallback(cb.id, 'Вход отменён');
    }

    try {
      await this.challenges.cancelFromBot(challengeId);
    } catch {
      /* already expired/confirmed — still update UI */
    }

    const text = '❌ Вход отменён. Вы можете начать вход заново на сайте ONIX.';
    if (messageId != null) {
      await editTelegramMessage({ chatId, messageId, text, replyMarkup: { inline_keyboard: [] } });
    } else {
      await sendTelegramMessage({ chatId, text });
    }

    return { ok: true, cancelled: true };
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

function userFacingChallengeError(error: AuthPlatformError): string {
  switch (error.code) {
    case 'AUTH_LOGIN_CHALLENGE_EXPIRED':
      return 'Срок попытки входа истёк. Откройте вход на сайте ONIX ещё раз.';
    case 'AUTH_LOGIN_CHALLENGE_CONSUMED':
      return 'Эта попытка входа уже использована.';
    case 'AUTH_LOGIN_CHALLENGE_INVALID':
      return 'Ссылка входа недействительна. Начните вход заново на сайте ONIX.';
    case 'AUTH_LOGIN_CHALLENGE_STATE':
      return 'Статус попытки входа изменился. Обновите страницу сайта.';
    default:
      return error.message || 'Не удалось обработать вход.';
  }
}
