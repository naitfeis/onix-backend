import { Body, Controller, Headers, Logger, Post } from '@nestjs/common';
import { Public } from '../common';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import {
  answerTelegramCallback,
  editTelegramMessage,
  sendTelegramMessage,
  type TelegramApiResult,
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
  update_id?: number;
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
 *
 * Diagnostics: every hop logs with prefix [Bot] so ops can locate the first broken link.
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
    this.logger.log(JSON.stringify({
      msg: '[Bot] webhook hit',
      updateId: update?.update_id ?? null,
      hasMessage: Boolean(update?.message),
      hasCallback: Boolean(update?.callback_query),
      messageText: update?.message?.text ?? null,
      callbackData: update?.callback_query?.data ?? null,
      secretHeaderPresent: Boolean(secret),
    }));

    assertWebhookSecret(secret);
    this.logger.log('[Bot] webhook secret check passed');

    const start = update.message?.text?.trim();
    if (start?.startsWith('/start')) {
      this.logger.log(JSON.stringify({
        msg: '[Bot] received /start',
        rawText: start,
        telegramId: update.message?.from?.id ?? null,
        chatId: update.message?.chat?.id ?? null,
      }));

      if (!start.startsWith('/start ')) {
        this.logger.warn(JSON.stringify({
          msg: '[Bot] /start format not matched — expected "/start login_<challengeId>"',
          rawText: start,
          note: 'Chain breaks HERE if Telegram sent /start@BotName or payload-less /start',
        }));
        return { ok: true, ignored: true, reason: 'start_format' };
      }

      return this.onStartLogin(update);
    }

    const data = update.callback_query?.data;
    if (data?.startsWith('confirm_login:')) {
      this.logger.log(JSON.stringify({
        msg: '[Bot] callback received',
        kind: 'confirm',
        challengeId: data.slice('confirm_login:'.length),
        telegramId: update.callback_query?.from?.id ?? null,
        messageId: update.callback_query?.message?.message_id ?? null,
      }));
      return this.onConfirm(update, data.slice('confirm_login:'.length));
    }
    if (data?.startsWith('cancel_login:')) {
      this.logger.log(JSON.stringify({
        msg: '[Bot] callback received',
        kind: 'cancel',
        challengeId: data.slice('cancel_login:'.length),
        telegramId: update.callback_query?.from?.id ?? null,
      }));
      return this.onCancel(update, data.slice('cancel_login:'.length));
    }

    this.logger.log(JSON.stringify({
      msg: '[Bot] update ignored (no /start login_ / confirm / cancel)',
      updateId: update?.update_id ?? null,
    }));
    return { ok: true };
  }

  private async onStartLogin(update: TelegramUpdate) {
    const start = update.message?.text?.trim() ?? '';
    const param = start.slice('/start '.length).trim();
    const challengeId = parseLoginChallengeId(param);
    const chatId = update.message?.chat?.id;
    const from = update.message?.from;

    this.logger.log(JSON.stringify({
      msg: '[Bot] parse start payload',
      startParam: param,
      challengeId,
      telegramId: from?.id ?? null,
      chatId: chatId ?? null,
    }));

    if (!challengeId || chatId == null || !from) {
      this.logger.warn(JSON.stringify({
        msg: '[Bot] chain break — missing challengeId/chatId/from after /start',
        challengeId,
        chatId: chatId ?? null,
        hasFrom: Boolean(from),
      }));
      return { ok: true, prompted: false, reason: 'parse_failed' };
    }

    try {
      this.logger.log(JSON.stringify({
        msg: '[Bot] LoginChallenge lookup → openForBotPrompt()',
        challengeId,
      }));
      const prompt = await this.challenges.openForBotPrompt(challengeId);
      this.logger.log(JSON.stringify({
        msg: '[Bot] challenge found',
        challengeId: prompt.challengeId,
        challengeFound: true,
        status: prompt.status,
        createdIp: prompt.createdIp,
        hasUserAgent: Boolean(prompt.createdUserAgent),
        userLinked: 'n/a (IdentityLink resolved later on Website complete)',
        expiresAt: prompt.expiresAt.toISOString(),
      }));

      const text = formatLoginConfirmPrompt(
        {
          createdAt: prompt.createdAt,
          createdIp: prompt.createdIp,
          createdUserAgent: prompt.createdUserAgent,
        },
        from.first_name,
      );

      this.logger.log(JSON.stringify({
        msg: '[Bot] sending prompt…',
        challengeId,
        chatId,
        botTokenConfigured: Boolean(process.env.BOT_TOKEN),
      }));

      const sent = await sendTelegramMessage({
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
      this.logBotApi('[Bot] sendMessage result', sent);

      if (!sent.ok) {
        this.logger.error(JSON.stringify({
          msg: '[Bot] chain break — Telegram Bot API sendMessage FAILED',
          challengeId,
          statusAfterDb: prompt.status,
          note: 'DB may be OPENED but Website stays non-CONFIRMED until user confirms; without keyboard confirm never happens',
          ...sent,
        }));
        return { ok: true, prompted: false, reason: 'bot_api_send_failed', botApi: sent };
      }

      this.logger.log(JSON.stringify({
        msg: '[Bot] prompt delivered',
        challengeId,
        messageId: sent.messageId ?? null,
      }));
      return { ok: true, prompted: true, messageId: sent.messageId ?? null };
    } catch (error) {
      const message = error instanceof AuthPlatformError
        ? userFacingChallengeError(error)
        : 'Не удалось найти попытку входа. Откройте вход на сайте ONIX ещё раз.';
      this.logger.warn(JSON.stringify({
        msg: '[Bot] chain break — LoginChallenge lookup/open failed',
        challengeId,
        challengeFound: false,
        errorCode: error instanceof AuthPlatformError ? error.code : 'UNKNOWN',
        error: error instanceof Error ? error.message : String(error),
      }));
      const sent = await sendTelegramMessage({ chatId, text: message });
      this.logBotApi('[Bot] error notify sendMessage', sent);
      return { ok: true, prompted: false, reason: 'challenge_lookup_failed' };
    }
  }

  private async onConfirm(update: TelegramUpdate, challengeId: string) {
    const cb = update.callback_query;
    const from = cb?.from;
    const chatId = cb?.message?.chat?.id;
    const messageId = cb?.message?.message_id;
    if (!from || chatId == null) {
      this.logger.warn(JSON.stringify({
        msg: '[Bot] chain break — confirm callback missing from/chat',
        challengeId,
      }));
      return { ok: true };
    }

    if (cb?.id) {
      const answered = await answerTelegramCallback(cb.id);
      this.logBotApi('[Bot] answerCallbackQuery', answered);
    }

    try {
      this.logger.log(JSON.stringify({
        msg: '[Bot] confirmFromBot() start',
        challengeId,
        telegramId: from.id,
        statusBefore: '(see next log from service / result)',
      }));

      const result = await this.challenges.confirmFromBot(challengeId, {
        telegramId: BigInt(from.id),
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
      });

      this.logger.log(JSON.stringify({
        msg: '[Bot] confirmFromBot() done',
        challengeId,
        statusAfter: 'CONFIRMED',
        returnUrlHost: safeHost(result.returnUrl),
        note: 'Website poll should observe CONFIRMED next',
      }));

      const confirmedText = [
        '✅ <b>Вход успешно подтверждён</b>',
        '',
        'Вернитесь на сайт ONIX — авторизация завершится автоматически.',
        'Если страница не обновилась, нажмите кнопку ниже.',
      ].join('\n');

      if (messageId != null) {
        const edited = await editTelegramMessage({
          chatId,
          messageId,
          text: confirmedText,
          parseMode: 'HTML',
          replyMarkup: {
            inline_keyboard: [[{ text: 'Вернуться в ONIX', url: result.returnUrl }]],
          },
        });
        this.logBotApi('[Bot] editMessageText after confirm', edited);
      } else {
        const sent = await sendTelegramMessage({
          chatId,
          text: confirmedText,
          parseMode: 'HTML',
          replyMarkup: {
            inline_keyboard: [[{ text: 'Вернуться в ONIX', url: result.returnUrl }]],
          },
        });
        this.logBotApi('[Bot] sendMessage after confirm (no message_id)', sent);
      }

      return { ok: true, confirmed: true };
    } catch (error) {
      this.logger.error(JSON.stringify({
        msg: '[Bot] chain break — confirmFromBot failed',
        challengeId,
        errorCode: error instanceof AuthPlatformError ? error.code : 'UNKNOWN',
        error: error instanceof Error ? error.message : String(error),
      }));
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
      const cancelled = await this.challenges.cancelFromBot(challengeId);
      this.logger.log(JSON.stringify({
        msg: '[Bot] cancelFromBot() done',
        challengeId,
        statusAfter: cancelled.status,
      }));
    } catch (error) {
      this.logger.warn(JSON.stringify({
        msg: '[Bot] cancelFromBot failed (UI still updated)',
        challengeId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }

    const text = '❌ Вход отменён. Вы можете начать вход заново на сайте ONIX.';
    if (messageId != null) {
      await editTelegramMessage({ chatId, messageId, text, replyMarkup: { inline_keyboard: [] } });
    } else {
      await sendTelegramMessage({ chatId, text });
    }

    return { ok: true, cancelled: true };
  }

  private logBotApi(label: string, result: TelegramApiResult): void {
    const payload = { msg: label, ...result };
    if (result.ok) {
      this.logger.log(JSON.stringify(payload));
    } else {
      this.logger.error(JSON.stringify(payload));
    }
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

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(invalid-url)';
  }
}
