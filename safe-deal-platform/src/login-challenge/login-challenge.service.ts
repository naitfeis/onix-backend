import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { LoginChallenge } from '@prisma/client';
import { AuthOrchestrator } from '../auth-v2/auth-orchestrator.service';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import type { DeviceContext, SessionAuthResult } from '../auth-v2/session.service';
import type { VerifiedTelegramIdentity } from '../auth-v2/telegram-login.verifier';
import { LOGIN_CHALLENGE_TTL_MS } from './login-challenge.flags';
import { LoginChallengeRepository } from './login-challenge.repository';

/** Same payload Website `/complete` returns (Session + refreshMaxAge). */
export type BotLoginCompleteResult = SessionAuthResult & { refreshMaxAgeSeconds: number };

export type StartChallengeResult = {
  challengeId: string;
  nonce: string;
  loginSessionId: string;
  expiresAt: string;
  deepLink: string;
  webDeepLink: string;
  miniAppDeepLink: string;
  status: string;
};

export type ChallengeStatusResult = {
  challengeId: string;
  status: string;
  expiresAt: string;
};

/**
 * LoginChallenge lifecycle (SPA same-URL):
 *   CREATED → OPENED → CONFIRMED (= ready for Website complete) → CONSUMED
 *
 * CONFIRMED means Telegram proved telegramId. Session + refresh cookie are issued ONLY on
 * Website POST /complete (browser Set-Cookie). Webhook cannot set Website cookies.
 */
@Injectable()
export class LoginChallengeService {
  private readonly logger = new Logger(LoginChallengeService.name);

  constructor(
    private readonly challenges: LoginChallengeRepository,
    private readonly orchestrator: AuthOrchestrator,
  ) {}

  async start(input: {
    loginSessionId?: string;
    browserFingerprintHash?: string;
    createdIp?: string;
    createdUserAgent?: string;
  }): Promise<StartChallengeResult> {
    const loginSessionId = input.loginSessionId?.trim() || randomBytes(24).toString('hex');
    await this.challenges.expireIncompleteForSession(loginSessionId);
    const challenge = await this.challenges.create({
      loginSessionId,
      browserFingerprintHash: input.browserFingerprintHash,
      createdIp: input.createdIp,
      createdUserAgent: input.createdUserAgent,
    });

    const bot = botUsername();
    const startParam = `login_${challenge.id}`;
    const deepLink = `tg://resolve?domain=${bot}&start=${startParam}`;
    const webDeepLink = `https://t.me/${bot}?start=${startParam}`;
    const miniAppDeepLink = `https://t.me/${bot}?startapp=${startParam}`;

    this.logger.log(JSON.stringify({
      msg: 'login_challenge_created',
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt.toISOString(),
    }));

    return {
      challengeId: challenge.id,
      nonce: challenge.nonce,
      loginSessionId,
      expiresAt: challenge.expiresAt.toISOString(),
      deepLink,
      webDeepLink,
      miniAppDeepLink,
      status: challenge.status,
    };
  }

  async markOpened(challengeId: string): Promise<ChallengeStatusResult> {
    const challenge = await this.requireFresh(challengeId);
    if (challenge.status === 'CREATED') {
      await this.challenges.markOpened(challengeId);
    }
    return this.status(challengeId);
  }

  async attachPromptChat(challengeId: string, chatId: number): Promise<boolean> {
    return this.challenges.claimTelegramChat(challengeId, BigInt(chatId));
  }

  /**
   * Telegram Desktop often sends a bare `/start` after the website click
   * (it types `/start` without `login_<id>`). Attach this chat's live challenge,
   * else the newest *unclaimed* website login still inside the TTL.
   * Never binds a challenge already claimed by another Telegram chat.
   */
  async openLatestLiveForBareStart(chatId?: number): Promise<{ challengeId: string } | null> {
    if (chatId != null) {
      const forChat = await this.challenges.findLatestLiveForChat(BigInt(chatId));
      if (forChat) {
        this.logger.log(JSON.stringify({
          msg: '[Bot] recovered live challenge for this Telegram chat',
          challengeId: forChat.id,
          status: forChat.status,
        }));
        return { challengeId: forChat.id };
      }
    }
    const row = await this.challenges.findLatestLiveGlobal(LOGIN_CHALLENGE_TTL_MS);
    if (!row) return null;
    if (chatId != null) {
      const claimed = await this.challenges.claimTelegramChat(row.id, BigInt(chatId));
      if (!claimed) {
        this.logger.warn(JSON.stringify({
          msg: '[Bot] skipped live challenge already claimed by another chat',
          challengeId: row.id,
        }));
        return null;
      }
    }
    this.logger.log(JSON.stringify({
      msg: '[Bot] recovered unclaimed live challenge for bare /start',
      challengeId: row.id,
      status: row.status,
    }));
    return { challengeId: row.id };
  }

  /**
   * Bot /start login_xxx: claim this chat, mark OPENED, return fields for the confirm prompt.
   */
  async openForBotPrompt(challengeId: string, chatId?: number): Promise<{
    challengeId: string;
    status: string;
    createdAt: Date;
    createdIp: string | null;
    createdUserAgent: string | null;
    expiresAt: Date;
  }> {
    this.logger.log(JSON.stringify({
      msg: '[Bot] openForBotPrompt lookup',
      challengeId,
      chatId: chatId ?? null,
    }));
    const live = await this.resolveLiveChallengeForBot(challengeId, chatId);
    if (chatId != null) {
      const claimed = await this.challenges.claimTelegramChat(live.id, BigInt(chatId));
      if (!claimed) {
        throw new AuthPlatformError(
          'AUTH_LOGIN_CHALLENGE_INVALID',
          'Login challenge is already claimed by another Telegram chat.',
        );
      }
    }
    await this.markOpened(live.id);
    const challenge = await this.requireFresh(live.id);
    this.logger.log(JSON.stringify({
      msg: '[Bot] openForBotPrompt result',
      challengeId: challenge.id,
      status: challenge.status,
      dbIdMatchesDeepLink: challenge.id === challengeId,
    }));
    return {
      challengeId: challenge.id,
      status: challenge.status,
      createdAt: challenge.createdAt,
      createdIp: challenge.createdIp,
      createdUserAgent: challenge.createdUserAgent,
      expiresAt: challenge.expiresAt,
    };
  }

  async cancelFromBot(challengeId: string): Promise<{ challengeId: string; status: string }> {
    const challenge = await this.requireFresh(challengeId);
    if (challenge.status === 'CONFIRMED' || challenge.status === 'CONSUMED') {
      throw new AuthPlatformError(
        'AUTH_LOGIN_CHALLENGE_STATE',
        'Challenge already confirmed; cannot cancel.',
      );
    }
    if (challenge.status === 'EXPIRED') {
      return { challengeId: challenge.id, status: 'EXPIRED' };
    }
    const expired = await this.challenges.markExpired(challengeId);
    this.logger.log(JSON.stringify({
      msg: 'login_challenge_cancelled_by_bot',
      challengeId,
    }));
    return { challengeId: expired.id, status: expired.status };
  }

  async status(challengeId: string): Promise<ChallengeStatusResult> {
    const challenge = await this.requireFresh(challengeId);
    return {
      challengeId: challenge.id,
      status: challenge.status,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  /**
   * Bot confirm: prove telegramId ownership only.
   * Does NOT create Session / Set-Cookie / returnUrl / exchangeCode.
   * User + IdentityLink + Session are created on Website complete via AuthOrchestrator.
   */
  async confirmFromBot(
    challengeId: string,
    identity: VerifiedTelegramIdentity,
    chatId?: number,
  ): Promise<{ challengeId: string; status: 'CONFIRMED' }> {
    const challenge = await this.requireFresh(challengeId);
    if (
      chatId != null
      && challenge.telegramChatId != null
      && challenge.telegramChatId !== BigInt(chatId)
    ) {
      throw new AuthPlatformError(
        'AUTH_LOGIN_CHALLENGE_STATE',
        'Login challenge belongs to another Telegram chat.',
      );
    }
    const statusBefore = challenge.status;
    this.logger.log(JSON.stringify({
      msg: '[Bot] confirmFromBot status before',
      challengeId,
      statusBefore,
      telegramId: identity.telegramId.toString(),
    }));

    if (challenge.status === 'CONFIRMED') {
      if (challenge.telegramId && challenge.telegramId !== identity.telegramId) {
        throw new AuthPlatformError(
          'AUTH_LOGIN_CHALLENGE_STATE',
          'Challenge already confirmed by another Telegram account.',
        );
      }
      this.logger.log(JSON.stringify({
        msg: '[Bot] confirmFromBot status after',
        challengeId,
        statusAfter: 'CONFIRMED',
        reused: true,
      }));
      return { challengeId: challenge.id, status: 'CONFIRMED' };
    }
    if (challenge.status === 'CONSUMED' || challenge.status === 'EXPIRED') {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_CONSUMED', 'Challenge is no longer usable.');
    }

    await this.challenges.markConfirmed(challengeId, {
      telegramId: identity.telegramId,
      telegramUsername: identity.username,
      telegramFirstName: identity.firstName,
      telegramLastName: identity.lastName,
      telegramPhotoUrl: identity.photoUrl,
    });

    this.logger.log(JSON.stringify({
      msg: 'login_challenge_confirmed',
      challengeId,
      telegramId: identity.telegramId.toString(),
      statusBefore,
      statusAfter: 'CONFIRMED',
      note: 'ready for Website poll → complete (no returnUrl)',
    }));

    return { challengeId, status: 'CONFIRMED' };
  }

  /**
   * Website same-origin complete: Identity upsert + Session + tokens.
   * Refresh cookie is set by the controller on this browser response.
   */
  async complete(input: {
    challengeId: string;
    loginSessionId: string;
    rememberMe?: boolean;
    device?: DeviceContext;
  }): Promise<BotLoginCompleteResult> {
    const challenge = await this.requireFresh(input.challengeId);
    this.assertLoginSession(challenge, input.loginSessionId);

    if (challenge.status === 'CONSUMED') {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_CONSUMED', 'Challenge already consumed.');
    }
    if (challenge.status !== 'CONFIRMED' || !challenge.telegramId) {
      throw new AuthPlatformError(
        'AUTH_LOGIN_CHALLENGE_PENDING',
        'Challenge is not confirmed yet.',
      );
    }

    const identity = identityFromChallenge(challenge);
    const session = await this.orchestrator.loginWithVerifiedTelegramIdentity(identity, {
      rememberMe: input.rememberMe,
      device: input.device,
      amr: ['telegram-bot'],
    });

    await this.challenges.markConsumed(challenge.id);

    this.logger.log(JSON.stringify({
      msg: 'login_challenge_consumed',
      challengeId: challenge.id,
      sessionId: session.session.id,
      userId: session.user.id.toString(),
    }));

    return session;
  }

  /** Attach the confirmed Telegram identity to the already-signed-in Website user. */
  async linkConfirmedChallengeToUser(input: {
    challengeId: string;
    loginSessionId: string;
    userId: bigint;
  }): Promise<{ linked: true; hasTelegram: true; canSell: true }> {
    const challenge = await this.requireFresh(input.challengeId);
    this.assertLoginSession(challenge, input.loginSessionId);
    if (challenge.status === 'CONSUMED') {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_CONSUMED', 'Challenge already consumed.');
    }
    if (challenge.status !== 'CONFIRMED' || !challenge.telegramId) {
      throw new AuthPlatformError(
        'AUTH_LOGIN_CHALLENGE_PENDING',
        'Challenge is not confirmed yet.',
      );
    }
    const identity = identityFromChallenge(challenge);
    const result = await this.orchestrator.linkVerifiedTelegramToCurrentUser(input.userId, identity);
    await this.challenges.markConsumed(challenge.id);
    return result;
  }

  /**
   * @deprecated Exchange / return-URL login removed. Use poll → POST /complete on the same SPA URL.
   * Return type matches `/complete` for call-site compatibility; runtime always throws.
   */
  async completeWithExchangeCode(_input: {
    exchangeCode: string;
    loginSessionId?: string;
    rememberMe?: boolean;
    device?: DeviceContext;
  }): Promise<BotLoginCompleteResult> {
    void _input;
    throw new AuthPlatformError(
      'AUTH_LOGIN_CHALLENGE_INVALID',
      'Exchange-code login is disabled. Stay on the Website tab; polling completes after Telegram confirm.',
    );
  }

  private assertLoginSession(challenge: LoginChallenge, loginSessionId: string): void {
    if (challenge.loginSessionId !== loginSessionId) {
      throw new AuthPlatformError(
        'AUTH_CSRF_REJECTED',
        'Login session does not match this challenge.',
      );
    }
  }

  /**
   * Telegram Desktop often delivers an older start=login_id after the user clicked login again.
   * Reuse: same browser session, this chat's live challenge, or an *unclaimed* live login.
   * Never return a challenge already bound to another Telegram chat.
   */
  private async resolveLiveChallengeForBot(
    challengeId: string,
    chatId?: number,
  ): Promise<LoginChallenge> {
    const row = await this.challenges.findById(challengeId);
    if (!row) {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_INVALID', 'Login challenge not found.');
    }
    const liveNow = (row.status === 'CREATED' || row.status === 'OPENED')
      && row.expiresAt.getTime() > Date.now();
    if (liveNow) {
      if (!usableByChat(row, chatId)) {
        throw new AuthPlatformError(
          'AUTH_LOGIN_CHALLENGE_INVALID',
          'Login challenge is already claimed by another Telegram chat.',
        );
      }
      return row;
    }
    const sibling = await this.challenges.findLatestLiveForSession(row.loginSessionId);
    if (sibling && usableByChat(sibling, chatId)) {
      this.logger.log(JSON.stringify({
        msg: '[Bot] recovered live challenge from same login session',
        from: challengeId,
        to: sibling.id,
      }));
      return sibling;
    }
    if (chatId != null) {
      const forChat = await this.challenges.findLatestLiveForChat(BigInt(chatId));
      if (forChat) {
        this.logger.log(JSON.stringify({
          msg: '[Bot] recovered live challenge for this Telegram chat after stale payload',
          from: challengeId,
          to: forChat.id,
        }));
        return forChat;
      }
    }
    const unclaimed = await this.challenges.findLatestLiveGlobal(LOGIN_CHALLENGE_TTL_MS);
    if (unclaimed && usableByChat(unclaimed, chatId)) {
      this.logger.log(JSON.stringify({
        msg: '[Bot] recovered unclaimed live challenge after stale payload',
        from: challengeId,
        to: unclaimed.id,
      }));
      return unclaimed;
    }
    if (row.status === 'EXPIRED' || row.expiresAt.getTime() <= Date.now()) {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_EXPIRED', 'Login challenge expired.');
    }
    throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_INVALID', 'Login challenge not found.');
  }

  private async requireFresh(challengeId: string): Promise<LoginChallenge> {
    const challenge = await this.challenges.findById(challengeId);
    if (!challenge) {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_INVALID', 'Login challenge not found.');
    }
    if (challenge.status === 'EXPIRED') {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_EXPIRED', 'Login challenge expired.');
    }
    if (challenge.status !== 'CONSUMED' && challenge.expiresAt.getTime() <= Date.now()) {
      await this.challenges.markExpired(challenge.id).catch(() => undefined);
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_EXPIRED', 'Login challenge expired.');
    }
    return challenge;
  }
}

function usableByChat(row: LoginChallenge, chatId?: number): boolean {
  if (row.telegramChatId == null) return true;
  if (chatId == null) return false;
  return row.telegramChatId === BigInt(chatId);
}

function identityFromChallenge(challenge: LoginChallenge): VerifiedTelegramIdentity {
  if (!challenge.telegramId) {
    throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_PENDING', 'Telegram identity missing.');
  }
  return {
    telegramId: challenge.telegramId,
    username: challenge.telegramUsername ?? undefined,
    firstName: challenge.telegramFirstName ?? undefined,
    lastName: challenge.telegramLastName ?? undefined,
    photoUrl: challenge.telegramPhotoUrl ?? undefined,
  };
}

function botUsername(): string {
  const raw = process.env.TELEGRAM_BOT_USERNAME || process.env.VITE_TELEGRAM_BOT_USERNAME || 'Onixshop_bot';
  return raw.replace(/^@/, '');
}
