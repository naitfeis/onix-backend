import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { LoginChallenge } from '@prisma/client';
import { AuthOrchestrator } from '../auth-v2/auth-orchestrator.service';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import type { DeviceContext } from '../auth-v2/session.service';
import type { VerifiedTelegramIdentity } from '../auth-v2/telegram-login.verifier';
import { LOGIN_EXCHANGE_TTL_MS } from './login-challenge.flags';
import { LoginChallengeRepository, sha256Hex } from './login-challenge.repository';

export type StartChallengeResult = {
  challengeId: string;
  nonce: string;
  loginSessionId: string;
  expiresAt: string;
  deepLink: string;
  webDeepLink: string;
  status: string;
};

export type ChallengeStatusResult = {
  challengeId: string;
  status: string;
  expiresAt: string;
  returnUrl?: string;
};

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

  /**
   * Bot /start login_xxx: mark OPENED and return fields for the confirm prompt.
   * Does not change IdentityLink / Session / Token — presentation only.
   */
  async openForBotPrompt(challengeId: string): Promise<{
    challengeId: string;
    status: string;
    createdAt: Date;
    createdIp: string | null;
    createdUserAgent: string | null;
    expiresAt: Date;
  }> {
    await this.markOpened(challengeId);
    const challenge = await this.requireFresh(challengeId);
    return {
      challengeId: challenge.id,
      status: challenge.status,
      createdAt: challenge.createdAt,
      createdIp: challenge.createdIp,
      createdUserAgent: challenge.createdUserAgent,
      expiresAt: challenge.expiresAt,
    };
  }

  /**
   * Bot cancel button: expire a pending challenge so Website polling stops cleanly.
   */
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
    const result: ChallengeStatusResult = {
      challengeId: challenge.id,
      status: challenge.status,
      expiresAt: challenge.expiresAt.toISOString(),
    };
    if (challenge.status === 'CONFIRMED') {
      result.returnUrl = undefined; // populated only via bot message with exchange code
    }
    return result;
  }

  /**
   * Bot confirm: Telegram identity proof arrives only via Bot API (trusted).
   */
  async confirmFromBot(
    challengeId: string,
    identity: VerifiedTelegramIdentity,
  ): Promise<{ exchangeCode: string; returnUrl: string }> {
    const challenge = await this.requireFresh(challengeId);
    if (challenge.status === 'CONFIRMED') {
      if (challenge.telegramId && challenge.telegramId !== identity.telegramId) {
        throw new AuthPlatformError(
          'AUTH_LOGIN_CHALLENGE_STATE',
          'Challenge already confirmed by another Telegram account.',
        );
      }
      // Bot retry (same telegram): rotate exchange code, keep CONFIRMED.
      const exchangeCode = randomBytes(32).toString('hex');
      const exchangeCodeHash = sha256Hex(exchangeCode);
      await this.challenges.transition(challenge.id, ['CONFIRMED'], {
        exchangeCodeHash,
        exchangeExpiresAt: new Date(Date.now() + LOGIN_EXCHANGE_TTL_MS),
      });
      const returnUrl = `${websiteOrigin()}/login/continue?x=${exchangeCode}`;
      return { exchangeCode, returnUrl };
    }
    if (challenge.status === 'CONSUMED' || challenge.status === 'EXPIRED') {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_CONSUMED', 'Challenge is no longer usable.');
    }

    const { exchangeCode } = await this.challenges.markConfirmed(challengeId, {
      telegramId: identity.telegramId,
      telegramUsername: identity.username,
      telegramFirstName: identity.firstName,
      telegramLastName: identity.lastName,
      telegramPhotoUrl: identity.photoUrl,
    });

    const origin = websiteOrigin();
    const returnUrl = `${origin}/login/continue?x=${exchangeCode}`;

    this.logger.log(JSON.stringify({
      msg: 'login_challenge_confirmed',
      challengeId,
      telegramId: identity.telegramId.toString(),
    }));

    return { exchangeCode, returnUrl };
  }

  async complete(input: {
    challengeId: string;
    loginSessionId: string;
    rememberMe?: boolean;
    device?: DeviceContext;
  }) {
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

  async completeWithExchangeCode(input: {
    exchangeCode: string;
    loginSessionId?: string;
    rememberMe?: boolean;
    device?: DeviceContext;
  }) {
    const hash = sha256Hex(input.exchangeCode);
    const challenge = await this.challenges.findByExchangeCodeHash(hash);
    if (!challenge) {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_INVALID', 'Exchange code is invalid.');
    }
    if (input.loginSessionId) {
      this.assertLoginSession(challenge, input.loginSessionId);
    }
    return this.complete({
      challengeId: challenge.id,
      loginSessionId: challenge.loginSessionId,
      rememberMe: input.rememberMe,
      device: input.device,
    });
  }

  private assertLoginSession(challenge: LoginChallenge, loginSessionId: string): void {
    if (challenge.loginSessionId !== loginSessionId) {
      throw new AuthPlatformError(
        'AUTH_CSRF_REJECTED',
        'Login session does not match this challenge.',
      );
    }
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

function websiteOrigin(): string {
  return (process.env.WEBSITE_ORIGIN || process.env.PUBLIC_WEBSITE_ORIGIN || 'https://onix.gg').replace(/\/+$/, '');
}
