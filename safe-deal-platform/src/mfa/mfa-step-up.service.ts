import { Injectable, Logger, Optional } from '@nestjs/common';
import { AuthProvider, MfaMethod, Prisma } from '@prisma/client';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import {
  sendTelegramMessage,
  editTelegramMessage,
  answerTelegramCallback,
} from '../login-challenge/bot-telegram-api';
import { PrismaService } from '../prisma.service';
import {
  MFA_PURPOSE_WITHDRAW,
  mfaChallengeTtlMs,
  mfaDeepLinks,
  type IssuedMfaChallenge,
  type MfaChallengeStatus,
} from './mfa.types';

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class MfaStepUpService {
  private readonly logger = new Logger(MfaStepUpService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create PENDING Telegram challenge for withdraw and notify the user (best-effort).
   */
  async issueWithdrawChallenge(input: {
    userId: bigint;
    sessionId?: string | null;
    amountCents: bigint;
    score: number;
    factors: string[];
  }): Promise<IssuedMfaChallenge> {
    const expiresAt = new Date(Date.now() + mfaChallengeTtlMs());
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, telegramId: true },
    });
    if (!user?.telegramId) {
      throw new AuthPlatformError(
        'AUTH_STEP_UP_REQUIRED',
        'Для вывода нужно подтверждение в Telegram, но аккаунт не привязан к Telegram.',
        { reason: 'no_telegram' },
      );
    }

    const challenge = await this.prisma.mfaChallenge.create({
      data: {
        userId: input.userId,
        sessionId: input.sessionId ?? null,
        method: MfaMethod.TELEGRAM,
        status: 'PENDING',
        purpose: MFA_PURPOSE_WITHDRAW,
        expiresAt,
        metadata: {
          amountCents: input.amountCents.toString(),
          score: input.score,
          factors: input.factors,
        },
      },
    });

    await this.prisma.authAuditLog.create({
      data: {
        userId: input.userId,
        sessionId: input.sessionId ?? null,
        action: 'MFA_CHALLENGE_ISSUED',
        provider: AuthProvider.TELEGRAM,
        metadata: {
          challengeId: challenge.id,
          purpose: MFA_PURPOSE_WITHDRAW,
          method: 'TELEGRAM',
        },
      },
    }).catch(() => undefined);

    const links = mfaDeepLinks(challenge.id);
    const rubles = (Number(input.amountCents) / 100).toLocaleString('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    const sent = await sendTelegramMessage({
      chatId: telegramApiChatId(user.telegramId),
      parseMode: 'HTML',
      text: [
        '🔐 <b>Подтверждение вывода ONIX</b>',
        '',
        `Сумма: <b>${rubles} ₽</b>`,
        'Если это не вы — нажмите «Отклонить».',
        '',
        'Ссылка действует ограниченное время.',
      ].join('\n'),
      replyMarkup: {
        inline_keyboard: [[
          { text: '✅ Подтвердить', callback_data: `confirm_mfa:${challenge.id}` },
          { text: '❌ Отклонить', callback_data: `cancel_mfa:${challenge.id}` },
        ]],
      },
    });

    if (!sent.ok) {
      this.logger.warn(JSON.stringify({
        msg: 'mfa_telegram_notify_failed',
        challengeId: challenge.id,
        description: sent.description,
      }));
    }

    return {
      challengeId: challenge.id,
      expiresAt: expiresAt.toISOString(),
      deepLink: links.deepLink,
      webDeepLink: links.webDeepLink,
      delivery: sent.ok ? 'telegram' : 'deeplink',
    };
  }

  async getStatusForUser(challengeId: string, userId: bigint): Promise<{
    challengeId: string;
    status: MfaChallengeStatus;
    purpose: string;
    expiresAt: string;
  }> {
    const row = await this.prisma.mfaChallenge.findUnique({ where: { id: challengeId } });
    if (!row || row.userId !== userId) {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_INVALID', 'Challenge not found.');
    }
    const status = await this.normalizeExpiry(row);
    return {
      challengeId: row.id,
      status,
      purpose: row.purpose,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /**
   * Bot callback /start mfa_*: show confirm buttons if still PENDING.
   */
  async presentChallengeToTelegram(challengeId: string, telegramId: bigint, chatId: number): Promise<void> {
    const row = await this.prisma.mfaChallenge.findUnique({ where: { id: challengeId } });
    if (!row) {
      await sendTelegramMessage({ chatId, text: 'Запрос подтверждения не найден или устарел.' });
      return;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { telegramId: true },
    });
    if (!user?.telegramId || user.telegramId !== telegramId) {
      await sendTelegramMessage({ chatId, text: 'Этот запрос принадлежит другому аккаунту.' });
      return;
    }
    const status = await this.normalizeExpiry(row);
    if (status !== 'PENDING') {
      await sendTelegramMessage({
        chatId,
        text: status === 'CONFIRMED'
          ? 'Уже подтверждено. Вернитесь в ONIX и повторите вывод.'
          : `Запрос недоступен (статус: ${status}).`,
      });
      return;
    }
    const meta = row.metadata as { amountCents?: string } | null;
    const amount = meta?.amountCents ? (Number(meta.amountCents) / 100).toLocaleString('ru-RU') : '—';
    await sendTelegramMessage({
      chatId,
      parseMode: 'HTML',
      text: [
        '🔐 <b>Подтверждение вывода ONIX</b>',
        '',
        `Сумма: <b>${amount} ₽</b>`,
        'Нажмите «Подтвердить», если это вы.',
      ].join('\n'),
      replyMarkup: {
        inline_keyboard: [[
          { text: '✅ Подтвердить', callback_data: `confirm_mfa:${challengeId}` },
          { text: '❌ Отклонить', callback_data: `cancel_mfa:${challengeId}` },
        ]],
      },
    });
  }

  async confirmFromBot(challengeId: string, telegramId: bigint): Promise<{ status: MfaChallengeStatus }> {
    const row = await this.prisma.mfaChallenge.findUnique({ where: { id: challengeId } });
    if (!row) throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_INVALID', 'Challenge not found.');
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { telegramId: true },
    });
    if (!user?.telegramId || user.telegramId !== telegramId) {
      throw new AuthPlatformError('AUTH_PROVIDER_REJECTED', 'Telegram identity mismatch.');
    }
    const status = await this.normalizeExpiry(row);
    if (status === 'CONFIRMED' || status === 'CONSUMED') return { status };
    if (status !== 'PENDING') {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_STATE', `Challenge is ${status}.`);
    }
    await this.prisma.mfaChallenge.update({
      where: { id: challengeId },
      data: { status: 'CONFIRMED' },
    });
    await this.prisma.authAuditLog.create({
      data: {
        userId: row.userId,
        sessionId: row.sessionId,
        action: 'MFA_CHALLENGE_PASSED',
        provider: AuthProvider.TELEGRAM,
        metadata: { challengeId, purpose: row.purpose },
      },
    }).catch(() => undefined);
    return { status: 'CONFIRMED' };
  }

  async cancelFromBot(challengeId: string, telegramId: bigint): Promise<{ status: MfaChallengeStatus }> {
    const row = await this.prisma.mfaChallenge.findUnique({ where: { id: challengeId } });
    if (!row) throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_INVALID', 'Challenge not found.');
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { telegramId: true },
    });
    if (!user?.telegramId || user.telegramId !== telegramId) {
      throw new AuthPlatformError('AUTH_PROVIDER_REJECTED', 'Telegram identity mismatch.');
    }
    const status = await this.normalizeExpiry(row);
    if (status === 'CANCELED' || status === 'FAILED') return { status: 'CANCELED' };
    if (status !== 'PENDING') {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_STATE', `Challenge is ${status}.`);
    }
    await this.prisma.mfaChallenge.update({
      where: { id: challengeId },
      data: { status: 'CANCELED' },
    });
    await this.prisma.authAuditLog.create({
      data: {
        userId: row.userId,
        sessionId: row.sessionId,
        action: 'MFA_CHALLENGE_FAILED',
        provider: AuthProvider.TELEGRAM,
        metadata: { challengeId, purpose: row.purpose, reason: 'user_canceled' },
      },
    }).catch(() => undefined);
    return { status: 'CANCELED' };
  }

  /**
   * Consume a CONFIRMED challenge for withdraw — one-shot.
   */
  async consumeConfirmed(input: {
    challengeId: string;
    userId: bigint;
    purpose?: string;
    sessionId?: string | null;
    db?: Db;
  }): Promise<void> {
    const db = input.db ?? this.prisma;
    const row = await db.mfaChallenge.findUnique({ where: { id: input.challengeId } });
    if (!row || row.userId !== input.userId) {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_INVALID', 'Step-up challenge not found.');
    }
    const purpose = input.purpose ?? MFA_PURPOSE_WITHDRAW;
    if (row.purpose !== purpose) {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_STATE', 'Challenge purpose mismatch.');
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      await db.mfaChallenge.update({
        where: { id: row.id },
        data: { status: 'EXPIRED' },
      }).catch(() => undefined);
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_EXPIRED', 'Step-up challenge expired.');
    }
    if (row.status === 'CONSUMED') {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_CONSUMED', 'Step-up already used.');
    }
    if (row.status !== 'CONFIRMED') {
      throw new AuthPlatformError(
        'AUTH_LOGIN_CHALLENGE_PENDING',
        'Подтвердите вывод в Telegram, затем повторите запрос.',
        { challengeId: row.id, status: row.status },
      );
    }
    // Soft session bind: if challenge was issued for a session, prefer same session.
    if (row.sessionId && input.sessionId && row.sessionId !== input.sessionId) {
      this.logger.warn(JSON.stringify({
        msg: 'mfa_session_mismatch',
        challengeId: row.id,
        issuedSession: row.sessionId,
        currentSession: input.sessionId,
      }));
    }
    await db.mfaChallenge.update({
      where: { id: row.id },
      data: { status: 'CONSUMED' },
    });
  }

  private async normalizeExpiry(row: {
    id: string;
    status: string;
    expiresAt: Date;
  }): Promise<MfaChallengeStatus> {
    if (row.status === 'PENDING' && row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.mfaChallenge.update({
        where: { id: row.id },
        data: { status: 'EXPIRED' },
      }).catch(() => undefined);
      return 'EXPIRED';
    }
    return row.status as MfaChallengeStatus;
  }
}

/** Re-export for webhook edits after confirm */
export { answerTelegramCallback, editTelegramMessage };

function telegramApiChatId(id: bigint): number {
  if (id <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(id);
  // Bot API accepts large ids as number in JSON only when safe; clamp log + best effort.
  return Number(id);
}
