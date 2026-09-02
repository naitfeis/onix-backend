import {
  BadRequestException, Injectable, Logger, OnModuleInit, ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { createId } from '../economy/wallet/cuid';
import { sendTelegramMessage } from '../login-challenge/bot-telegram-api';
import { PrismaService } from '../prisma.service';
import { assertRateLimit } from '../rate-limit';
import { hashIp, hashMfaCode, hashPassword, mintMfaCode, verifyPassword } from './admin-crypto';
import { AdminSessionService } from './admin-session.service';

const MFA_TTL_MS = Number(process.env.ADMIN_MFA_TTL_MS ?? 10 * 60 * 1000);
const IP_TRUST_TTL_MS = Number(process.env.ADMIN_IP_TRUST_TTL_MS ?? 7 * 24 * 60 * 60 * 1000);

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
    userAgent?: string | null;
  }): Promise<
    | { mfaRequired: true; challengeId: string; debugCode?: string }
    | { mfaRequired: false; accessToken: string; refreshToken: string; maxAgeSeconds: number; admin: { id: string; email: string; role: AdminRole } }
  > {
    assertRateLimit(`admin-login:${input.ip ?? 'unknown'}`, 10, 60_000);
    const email = input.email.trim().toLowerCase();
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!admin || !verifyPassword(input.password, admin.passwordHash)) {
      throw new UnauthorizedException('Неверный email или пароль.');
    }

    const trusted = await this.findTrustedIp(admin.id, input.ip);
    if (trusted) {
      const issued = await this.issueSession(admin, input.ip, input.userAgent);
      await this.touchTrustedIp(admin.id, input.ip);
      return {
        mfaRequired: false,
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        maxAgeSeconds: issued.maxAgeSeconds,
        admin: issued.admin,
      };
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

    await this.rememberTrustedIp(challenge.adminUser.id, input.ip);

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

  async resumeFromIp(input: { ip?: string | null; userAgent?: string | null }) {
    assertRateLimit(`admin-resume:${input.ip ?? 'unknown'}`, 20, 60_000);
    const ipHash = hashIp(input.ip);
    if (!ipHash) throw new UnauthorizedException('Не удалось определить IP.');
    const matches = await this.prisma.adminTrustedIp.findMany({
      where: { ipHash, expiresAt: { gt: new Date() } },
      include: { adminUser: true },
      take: 3,
    });
    if (matches.length !== 1) {
      throw new UnauthorizedException('Нет доверенной admin-сессии для этого IP.');
    }
    const admin = matches[0]!.adminUser;
    const issued = await this.issueSession(admin, input.ip, input.userAgent);
    await this.touchTrustedIp(admin.id, input.ip);
    await this.prisma.adminActionLog.create({
      data: {
        adminUserId: admin.id,
        action: 'ADMIN_IP_RESUME',
        metadataJson: { sessionId: issued.sessionId },
      },
    });
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      maxAgeSeconds: issued.maxAgeSeconds,
      admin: issued.admin,
    };
  }

  private async issueSession(
    admin: { id: bigint; email: string; role: AdminRole },
    ip?: string | null,
    userAgent?: string | null,
  ) {
    const issued = await this.sessions.createSession({
      adminUserId: admin.id,
      role: admin.role,
      email: admin.email,
      ip,
      userAgent,
    });
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      maxAgeSeconds: issued.maxAgeSeconds,
      sessionId: issued.actor.sessionId,
      admin: {
        id: issued.actor.id.toString(),
        email: issued.actor.email,
        role: issued.actor.role,
      },
    };
  }

  private async findTrustedIp(adminUserId: bigint, ip?: string | null) {
    const ipHash = hashIp(ip);
    if (!ipHash) return null;
    return this.prisma.adminTrustedIp.findFirst({
      where: { adminUserId, ipHash, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
  }

  private async rememberTrustedIp(adminUserId: bigint, ip?: string | null): Promise<void> {
    const ipHash = hashIp(ip);
    if (!ipHash) return;
    const expiresAt = new Date(Date.now() + IP_TRUST_TTL_MS);
    await this.prisma.adminTrustedIp.upsert({
      where: { adminUserId_ipHash: { adminUserId, ipHash } },
      create: { adminUserId, ipHash, expiresAt, lastSeenAt: new Date() },
      update: { expiresAt, lastSeenAt: new Date() },
    });
  }

  private async touchTrustedIp(adminUserId: bigint, ip?: string | null): Promise<void> {
    await this.rememberTrustedIp(adminUserId, ip);
  }
}
