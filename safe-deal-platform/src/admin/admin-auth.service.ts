import {
  BadRequestException, Injectable, Logger, OnModuleInit, ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { createId } from '../economy/wallet/cuid';
import { sendTelegramMessage } from '../login-challenge/bot-telegram-api';
import { PrismaService } from '../prisma.service';
import { assertRateLimit } from '../rate-limit';
import {
  hashMfaCode, hashPassword, mintMfaCode, verifyPassword,
} from './admin-crypto';
import { AdminSessionService } from './admin-session.service';

const MFA_TTL_MS = Number(process.env.ADMIN_MFA_TTL_MS ?? 10 * 60 * 1000);

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AdminSessionService,
  ) {}

  async onModuleInit(): Promise<void> {
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!email || !password) return;
    const telegramIdRaw = process.env.ADMIN_BOOTSTRAP_TELEGRAM_ID?.trim();
    const telegramId = telegramIdRaw && /^\d+$/.test(telegramIdRaw)
      ? BigInt(telegramIdRaw)
      : undefined;
    const existing = await this.prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      if (telegramId && existing.telegramId === null) {
        await this.prisma.adminUser.update({
          where: { id: existing.id },
          data: { telegramId },
        });
        this.logger.log('admin_bootstrap_telegram_bound');
      }
      return;
    }
    const count = await this.prisma.adminUser.count();
    if (count > 0) return;
    if (password.length < 12) {
      this.logger.warn('ADMIN_BOOTSTRAP_PASSWORD too short — bootstrap skipped');
      return;
    }
    await this.prisma.adminUser.create({
      data: {
        email,
        passwordHash: hashPassword(password),
        role: AdminRole.SUPER_ADMIN,
        telegramId,
      },
    });
    this.logger.log('admin_bootstrap_created');
  }

  async login(input: {
    email: string;
    password: string;
    ip?: string | null;
  }): Promise<{ mfaRequired: true; challengeId: string; debugCode?: string }> {
    assertRateLimit(`admin-login:${input.ip ?? 'unknown'}`, 10, 60_000);
    const email = input.email.trim().toLowerCase();
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!admin || !verifyPassword(input.password, admin.passwordHash)) {
      throw new UnauthorizedException('Неверный email или пароль.');
    }

    const code = mintMfaCode();
    const challengeId = createId();
    const debug =
      process.env.NODE_ENV !== 'production'
      || (process.env.ADMIN_MFA_DEBUG ?? '').trim().toLowerCase() === 'true';
    if (!admin.telegramId && !debug) {
      throw new ServiceUnavailableException('Для admin MFA не настроен Telegram ID.');
    }
    await this.prisma.adminMfaChallenge.create({
      data: {
        id: challengeId,
        adminUserId: admin.id,
        codeHash: hashMfaCode(code),
        expiresAt: new Date(Date.now() + MFA_TTL_MS),
      },
    });
    if (admin.telegramId) {
      const sent = await sendTelegramMessage({
        chatId: admin.telegramId.toString(),
        text: `ONIX Admin MFA code: ${code}\n\nCode expires in ${Math.ceil(MFA_TTL_MS / 60_000)} minutes. If you did not request this, do not share the code.`,
      });
      if (!sent.ok && !debug) {
        await this.prisma.adminMfaChallenge.delete({ where: { id: challengeId } });
        this.logger.error(JSON.stringify({
          msg: 'admin_mfa_delivery_failed',
          challengeId,
          adminUserId: admin.id.toString(),
          statusCode: sent.statusCode ?? null,
          errorCode: sent.errorCode ?? null,
        }));
        throw new ServiceUnavailableException('Не удалось доставить admin MFA-код.');
      }
    }
    await this.prisma.adminActionLog.create({
      data: {
        adminUserId: admin.id,
        action: 'ADMIN_LOGIN_MFA_ISSUED',
        metadataJson: { challengeId },
      },
    });

    this.logger.log(JSON.stringify({
      msg: 'admin_mfa_challenge_created',
      challengeId,
      adminUserId: admin.id.toString(),
    }));

    return {
      mfaRequired: true,
      challengeId,
      ...(debug ? { debugCode: code } : {}),
    };
  }

  async verifyMfa(input: {
    challengeId: string;
    code: string;
    ip?: string | null;
    userAgent?: string | null;
  }) {
    assertRateLimit(`admin-mfa:${input.ip ?? 'unknown'}`, 20, 60_000);
    const challenge = await this.prisma.adminMfaChallenge.findUnique({
      where: { id: input.challengeId },
      include: { adminUser: true },
    });
    if (!challenge || challenge.consumedAt) {
      throw new BadRequestException('MFA challenge invalid.');
    }
    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('MFA challenge expired.');
    }
    if (hashMfaCode(input.code.trim()) !== challenge.codeHash) {
      throw new UnauthorizedException('Неверный MFA-код.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.adminMfaChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      const issued = await this.sessions.createSession({
        adminUserId: challenge.adminUser.id,
        role: challenge.adminUser.role,
        email: challenge.adminUser.email,
        ip: input.ip,
        userAgent: input.userAgent,
        db: tx,
      });
      await tx.adminUser.update({
        where: { id: challenge.adminUser.id },
        data: { lastLoginAt: new Date() },
      });
      await tx.adminActionLog.create({
        data: {
          adminUserId: challenge.adminUser.id,
          action: 'ADMIN_LOGIN_SUCCESS',
          metadataJson: { sessionId: issued.actor.sessionId },
        },
      });
      return issued;
    });

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      maxAgeSeconds: result.maxAgeSeconds,
      admin: {
        id: result.actor.id.toString(),
        email: result.actor.email,
        role: result.actor.role,
      },
    };
  }

  async logout(sessionId: string, adminUserId: bigint): Promise<void> {
    await this.sessions.revokeSession(sessionId);
    await this.prisma.adminActionLog.create({
      data: {
        adminUserId,
        action: 'ADMIN_LOGOUT',
        metadataJson: { sessionId },
      },
    });
  }

  async me(actor: { id: bigint; email: string; role: AdminRole }) {
    return {
      id: actor.id.toString(),
      email: actor.email,
      role: actor.role,
    };
  }
}
