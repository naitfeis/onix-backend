import { Body, Controller, Headers, Logger, Post } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Public } from '../common';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import { MfaStepUpService } from '../mfa/mfa-step-up.service';
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

/** `/start`, `/start@Bot login_…`, `/start mfa_…` — Telegram Desktop often sends a bare `/start`. */
export function parseBotStartCommand(text: string | undefined): {
  kind: 'none' | 'bare' | 'login' | 'mfa' | 'other';
  payload: string;
} {
  const trimmed = text?.trim() ?? '';
  const match = trimmed.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return { kind: 'none', payload: '' };
  const payload = (match[1] ?? '').trim();
  if (!payload) return { kind: 'bare', payload: '' };
  if (payload.startsWith('login_')) return { kind: 'login', payload };
  if (payload.startsWith('mfa_')) return { kind: 'mfa', payload };
  return { kind: 'other', payload };
}

/** Log-safe webhook summary — never includes message body or login payload. */
export function summarizeTelegramWebhookForLog(
  update: TelegramUpdate | undefined,
  secretPresent: boolean,
): Record<string, string | number | boolean | null> {
  const text = update?.message?.text;
  const data = update?.callback_query?.data;
  const start = parseBotStartCommand(typeof text === 'string' ? text : undefined);
  const startKind = start.kind === 'none' ? null : start.kind;
  const callbackKind = typeof data === 'string' ? (data.split(':')[0] ?? '').slice(0, 40) : null;
  return {
    msg: '[Bot] webhook hit',
    updateId: update?.update_id ?? null,
    hasMessage: Boolean(update?.message),
    hasCallback: Boolean(update?.callback_query),
    textLen: typeof text === 'string' ? text.length : 0,
    startKind,
    callbackKind: callbackKind || null,
    secretHeaderPresent: secretPresent,
  };
}

/**
 * Telegram Bot webhook — LoginChallenge UX + MFA step-up (Slice 3).
 */
@Public()
@Controller('telegram')
export class BotWebhookHandler {
  private readonly logger = new Logger(BotWebhookHandler.name);

  constructor(
    private readonly challenges: LoginChallengeService,
    private readonly mfa: MfaStepUpService,
  ) {}

  @Post('webhook')
  async handle(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: TelegramUpdate,
  ) {
    this.logger.log(JSON.stringify(summarizeTelegramWebhookForLog(update, Boolean(secret))));

    assertWebhookSecret(secret);
    this.logger.log('[Bot] webhook secret check passed');

    const start = parseBotStartCommand(update.message?.text);
    if (start.kind !== 'none') {
      this.logger.log(JSON.stringify({
        msg: '[Bot] received /start',
        startKind: start.kind,
        telegramId: update.message?.from?.id ?? null,
        chatId: update.message?.chat?.id ?? null,
      }));

      if (start.kind === 'bare' || start.kind === 'other') {
        return this.onBareStart(update);
      }
      if (start.kind === 'mfa') {
        return this.onStartMfa(update, start.payload.slice('mfa_'.length));
      }
      return this.onStartLogin(update, start.payload);
    }

    const data = update.callback_query?.data;
    if (data?.startsWith('confirm_login:')) {
      return this.onConfirm(update, data.slice('confirm_login:'.length));
    }
    if (data?.startsWith('cancel_login:')) {
      return this.onCancel(update, data.slice('cancel_login:'.length));
    }
    if (data?.startsWith('confirm_mfa:')) {
      return this.onConfirmMfa(update, data.slice('confirm_mfa:'.length));
    }
    if (data?.startsWith('cancel_mfa:')) {
      return this.onCancelMfa(update, data.slice('cancel_mfa:'.length));
    }

    this.logger.log(JSON.stringify({
      msg: '[Bot] update ignored',
      updateId: update?.update_id ?? null,
    }));
    return { ok: true };
  }

  private async onStartMfa(update: TelegramUpdate, challengeId: string) {
    const from = update.message?.from;
    const chatId = update.message?.chat?.id;
    if (!from || chatId == null || !challengeId) {
      return { ok: true, ignored: true };
    }
    try {
      await this.mfa.presentChallengeToTelegram(challengeId, BigInt(from.id), chatId);
    } catch (error) {
      this.logger.warn(JSON.stringify({
        msg: '[Bot] mfa present failed',
        error: error instanceof Error ? error.message : String(error),
      }));
      await sendTelegramMessage({
        chatId,
        text: 'Не удалось открыть подтверждение. Запросите вывод ещё раз в ONIX.',
      });
    }
    return { ok: true };
  }

  private async onConfirmMfa(update: TelegramUpdate, challengeId: string) {
    const cb = update.callback_query;
    const from = cb?.from;
    const chatId = cb?.message?.chat?.id;
    if (!from || chatId == null) return { ok: true };
    if (cb?.id) await answerTelegramCallback(cb.id);
    try {
      await this.mfa.confirmFromBot(challengeId, BigInt(from.id));
      if (cb?.message?.message_id != null) {
        await editTelegramMessage({
          chatId,
          messageId: cb.message.message_id,
          text: '✅ Вывод подтверждён. Вернитесь в ONIX и нажмите «Повторить вывод».',
        });
      } else {
        await sendTelegramMessage({
          chatId,
          text: '✅ Вывод подтверждён. Вернитесь в ONIX и повторите запрос.',
        });
      }
    } catch (error) {
      const msg = error instanceof AuthPlatformError
        ? error.message
        : 'Не удалось подтвердить.';
      await sendTelegramMessage({ chatId, text: `⚠️ ${msg}` });
    }
    return { ok: true };
  }

  private async onCancelMfa(update: TelegramUpdate, challengeId: string) {
    const cb = update.callback_query;
    const from = cb?.from;
    const chatId = cb?.message?.chat?.id;
    if (!from || chatId == null) return { ok: true };
    if (cb?.id) await answerTelegramCallback(cb.id);
    try {
      await this.mfa.cancelFromBot(challengeId, BigInt(from.id));
      if (cb?.message?.message_id != null) {
        await editTelegramMessage({
          chatId,
          messageId: cb.message.message_id,
          text: '❌ Вывод отклонён.',
        });
      }
    } catch (error) {
      const msg = error instanceof AuthPlatformError
        ? error.message
        : 'Не удалось отклонить.';
      await sendTelegramMessage({ chatId, text: `⚠️ ${msg}` });
    }
    return { ok: true };
  }

  private async onBareStart(update: TelegramUpdate) {
    const chatId = update.message?.chat?.id;
    if (chatId == null) return { ok: true, ignored: true, reason: 'start_format' };
    this.logger.warn(JSON.stringify({
      msg: '[Bot] /start without login payload — Telegram likely focused an existing chat',
      telegramId: update.message?.from?.id ?? null,
      chatId,
    }));
    const sent = await sendTelegramMessage({
      chatId,
      text: [
        'Чтобы войти на сайт ONIX, нажмите «Войти через Telegram» на сайте и не закрывайте вкладку.',
        '',
        'Голая команда /start вход не открывает. Если Telegram уже был открыт — вернитесь на сайт и нажмите кнопку ещё раз: в этом чате должна появиться клавиатура «Подтвердить вход».',
      ].join('\n'),
      replyMarkup: {
        inline_keyboard: [[{ text: 'Открыть ONIX', url: 'https://www.onixtg.shop' }]],
      },
    });
    this.logBotApi('[Bot] bare /start help sendMessage', sent);
    return { ok: true, prompted: false, reason: 'start_format', helped: true };
  }

  private async onStartLogin(update: TelegramUpdate, startParam: string) {
    const challengeId = parseLoginChallengeId(startParam);
    const chatId = update.message?.chat?.id;
    const from = update.message?.from;

    this.logger.log(JSON.stringify({
      msg: '[Bot] parse start payload',
      startParam,
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
        // Bot updates never include photo_url — AvatarService pulls via Bot API using tg:profile.
        photoUrl: `tg:profile:${from.id}`,
      });

      this.logger.log(JSON.stringify({
        msg: '[Bot] confirmFromBot() done',
        challengeId: result.challengeId,
        statusAfter: result.status,
        note: 'Website poll should observe CONFIRMED → complete on same SPA URL (no returnUrl)',
      }));

      const confirmedText = [
        '✅ <b>Вход успешно подтверждён</b>',
        '',
        'Вернитесь на вкладку сайта ONIX.',
        'Вход завершится автоматически — ничего нажимать не нужно.',
      ].join('\n');

      if (messageId != null) {
        const edited = await editTelegramMessage({
          chatId,
          messageId,
          text: confirmedText,
          parseMode: 'HTML',
          replyMarkup: { inline_keyboard: [] },
        });
        this.logBotApi('[Bot] editMessageText after confirm', edited);
      } else {
        const sent = await sendTelegramMessage({
          chatId,
          text: confirmedText,
          parseMode: 'HTML',
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
  if (!expected) {
    // Production must never accept unauthenticated webhook POSTs.
    if (process.env.NODE_ENV === 'production') {
      throw new AuthPlatformError(
        'AUTH_PROVIDER_REJECTED',
        'Telegram webhook secret is not configured.',
      );
    }
    return; // local / test only
  }
  if (!secret || !timingSafeEqualUtf8(secret, expected)) {
    throw new AuthPlatformError('AUTH_PROVIDER_REJECTED', 'Invalid Telegram webhook secret.');
  }
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
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
