import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { AuthPlatformError } from './auth-errors';

export interface TelegramLoginPayload {
  id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface VerifiedTelegramIdentity {
  telegramId: bigint;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
}

/**
 * Website Telegram Login Widget verification (same crypto as legacy /telegram-login).
 * Isolated in auth-v2 so legacy AuthService remains untouched.
 */
@Injectable()
export class TelegramLoginVerifier {
  private readonly maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS ?? 3600);

  verify(dto: TelegramLoginPayload): VerifiedTelegramIdentity {
    this.assertFresh(dto.auth_date);
    const { hash, ...data } = dto;
    const check = Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    this.verifyHash(check, hash, createHash('sha256').update(this.botToken()).digest());
    return {
      telegramId: BigInt(dto.id),
      username: dto.username,
      firstName: dto.first_name,
      lastName: dto.last_name,
      photoUrl: dto.photo_url,
    };
  }

  private verifyHash(check: string, received: string, secret: Buffer): void {
    const expected = createHmac('sha256', secret).update(check).digest();
    const actual = Buffer.from(received, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new AuthPlatformError('AUTH_PROVIDER_REJECTED', 'Telegram login signature is invalid.');
    }
  }

  private assertFresh(authDate: number): void {
    const age = Math.floor(Date.now() / 1000) - authDate;
    if (!Number.isSafeInteger(authDate) || age < -30 || age > this.maxAgeSeconds) {
      throw new AuthPlatformError('AUTH_PROVIDER_REJECTED', 'Telegram login payload is stale.');
    }
  }

  private botToken(): string {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      throw new AuthPlatformError('AUTH_MISCONFIGURED', 'BOT_TOKEN is not configured.');
    }
    return token;
  }
}
