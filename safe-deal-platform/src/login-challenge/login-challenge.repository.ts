import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { LoginChallenge, LoginChallengeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import { LOGIN_CHALLENGE_TTL_MS } from './login-challenge.flags';

export type CreateChallengeInput = {
  loginSessionId: string;
  browserFingerprintHash?: string;
  createdIp?: string;
  createdUserAgent?: string;
};

@Injectable()
export class LoginChallengeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async expireIncompleteForSession(loginSessionId: string): Promise<void> {
    await this.prisma.loginChallenge.updateMany({
      where: { loginSessionId, status: { in: ['CREATED', 'OPENED'] } },
      data: { status: 'EXPIRED' },
    });
  }

  async findLatestLiveForSession(loginSessionId: string): Promise<LoginChallenge | null> {
    return this.prisma.loginChallenge.findFirst({
      where: {
        loginSessionId,
        status: { in: ['CREATED', 'OPENED'] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Live challenge for this Telegram chat, else a very fresh global one (Desktop drops start payload).
   */
  async findLatestLiveForChat(chatId: bigint): Promise<LoginChallenge | null> {
    return this.prisma.loginChallenge.findFirst({
      where: {
        telegramChatId: chatId,
        status: { in: ['CREATED', 'OPENED'] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async attachTelegramChat(id: string, chatId: bigint): Promise<void> {
    await this.prisma.loginChallenge.updateMany({
      where: { id },
      data: { telegramChatId: chatId },
    });
  }

  /**
   * Newest live website login in the TTL window.
   * Used when Telegram Desktop delivers a bare `/start` and drops `login_<id>`.
   */
  async findLatestLiveGlobal(withinMs: number): Promise<LoginChallenge | null> {
    return this.prisma.loginChallenge.findFirst({
      where: {
        status: { in: ['CREATED', 'OPENED'] },
        expiresAt: { gt: new Date() },
        createdAt: { gte: new Date(Date.now() - withinMs) },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(input: CreateChallengeInput): Promise<LoginChallenge> {
    const now = new Date();
    return this.prisma.loginChallenge.create({
      data: {
        nonce: randomBytes(32).toString('hex'),
        loginSessionId: input.loginSessionId,
        browserFingerprintHash: input.browserFingerprintHash,
        createdIp: input.createdIp,
        createdUserAgent: input.createdUserAgent,
        status: 'CREATED',
        expiresAt: new Date(now.getTime() + LOGIN_CHALLENGE_TTL_MS),
      },
    });
  }

  findById(id: string): Promise<LoginChallenge | null> {
    return this.prisma.loginChallenge.findUnique({ where: { id } });
  }

  findByNonce(nonce: string): Promise<LoginChallenge | null> {
    return this.prisma.loginChallenge.findUnique({ where: { nonce } });
  }

  findByExchangeCodeHash(hash: string): Promise<LoginChallenge | null> {
    return this.prisma.loginChallenge.findUnique({ where: { exchangeCodeHash: hash } });
  }

  async transition(
    id: string,
    from: LoginChallengeStatus[],
    data: Prisma.LoginChallengeUpdateManyMutationInput,
  ): Promise<LoginChallenge> {
    const result = await this.prisma.loginChallenge.updateMany({
      where: { id, status: { in: from } },
      data,
    });
    if (result.count !== 1) {
      throw new AuthPlatformError(
        'AUTH_LOGIN_CHALLENGE_STATE',
        'Login challenge cannot transition from its current state.',
      );
    }
    const row = await this.findById(id);
    if (!row) {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_INVALID', 'Login challenge not found.');
    }
    return row;
  }

  async markOpened(id: string): Promise<LoginChallenge> {
    return this.transition(id, ['CREATED', 'OPENED'], { status: 'OPENED' });
  }

  async markConfirmed(
    id: string,
    profile: {
      telegramId: bigint;
      telegramUsername?: string;
      telegramFirstName?: string;
      telegramLastName?: string;
      telegramPhotoUrl?: string;
    },
  ): Promise<LoginChallenge> {
    // No exchangeCode / returnUrl — Website completes via poll + same-origin POST /complete.
    return this.transition(id, ['CREATED', 'OPENED'], {
      status: 'CONFIRMED',
      telegramId: profile.telegramId,
      telegramUsername: profile.telegramUsername,
      telegramFirstName: profile.telegramFirstName,
      telegramLastName: profile.telegramLastName,
      telegramPhotoUrl: profile.telegramPhotoUrl,
      confirmedAt: new Date(),
      exchangeCodeHash: null,
      exchangeExpiresAt: null,
    });
  }

  async markConsumed(id: string): Promise<LoginChallenge> {
    return this.transition(id, ['CONFIRMED'], {
      status: 'CONSUMED',
      consumedAt: new Date(),
      exchangeCodeHash: null,
      exchangeExpiresAt: null,
    });
  }

  async markExpired(id: string): Promise<LoginChallenge> {
    return this.transition(id, ['CREATED', 'OPENED', 'CONFIRMED'], {
      status: 'EXPIRED',
    });
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
