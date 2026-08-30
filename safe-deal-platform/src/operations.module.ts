import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Header, Injectable, Module, NotFoundException, Post, Req, Res,
} from '@nestjs/common';
import { BanReason, PlatformStatus, Prisma } from '@prisma/client';
import {
  IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request, Response } from 'express';
import { hostname as osHostname } from 'node:os';
import { BAN_CLEAR_DATA, BAN_REASON_LABELS, banDurationDays, banPublicInfo } from './ban-policy';
import { AuthUser, CurrentUser, Public } from './common';
import { AuthV2Module } from './auth-v2/auth-v2.module';
import { EscrowModule } from './escrow.module';
import { EconomyModule } from './economy/economy.module';
import { BalanceService } from './economy/wallet/balance.service';
import { ClawbackService } from './economy/wallet/clawback.service';
import { resolveCorrelationId } from './economy/wallet/correlation-id';
import type { LedgerWriteMeta, WithdrawAssertInput } from './economy/wallet/ledger-write.types';
import { WithdrawVelocityService } from './economy/wallet/withdraw-velocity';
import { IdempotencyService } from './idempotency/idempotency.service';
import { formatOnixId } from './onix-id';
import { requireUserByOnixId } from './onix-id-lookup';
import {
  flagsFromPlatformStatus, isPlatformStatus, isPrivilegedAdmin, isSuperAdminStatus,
} from './platform-status';
import { debugEndpointsEnabled } from './debug-endpoints';
import { buildInfo } from './build-info';
import { PrismaService } from './prisma.service';
import { RiskScoreService } from './risk-score.service';
import { RiskEngineService } from './risk/risk-engine.service';
import { RiskModule } from './risk/risk.module';
import { CoordinationModule } from './coordination/coordination.module';
import { SharedCoordinationService } from './coordination/shared-coordination.service';

class BalanceDto {
  @IsString() @Matches(/^-?[1-9]\d*$/) amountCents!: string;
  @IsString() @Length(16, 100) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
class BanDto {
  @IsBoolean() banned!: boolean;
  @IsOptional() @IsEnum(BanReason) reason?: BanReason;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  /** Required when reason=OTHER (1–3650 days). Ignored for fixed-duration reasons. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) durationDays?: number;
}
class WithdrawalDto {
  @IsString() @Matches(/^[1-9]\d*$/) amountCents!: string;
  @IsString() @Length(16, 100) idempotencyKey!: string;
  /** Slice 3 — CONFIRMED Telegram MFA challenge id */
  @IsOptional() @IsString() @Length(8, 64) stepUpChallengeId?: string;
}
@Injectable()
class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly risk: RiskScoreService,
    private readonly riskEngine: RiskEngineService,
    private readonly balance: BalanceService,
    private readonly clawbacks: ClawbackService,
    private readonly idempotency: IdempotencyService,
    private readonly withdrawVelocity: WithdrawVelocityService,
  ) {}

  async adjust(actor: AuthUser, onixId: string, dto: BalanceDto, correlationId?: string) {
    const resolved = await requireUserByOnixId(this.prisma, onixId);
    const corr = correlationId ?? resolveCorrelationId();
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUniqueOrThrow({ where: { id: resolved.id } });
      const amount = BigInt(dto.amountCents);
      const creditMeta: LedgerWriteMeta = {
        idempotencyKey: dto.idempotencyKey,
        description: dto.reason,
        actorUserId: actor.id,
        source: 'ADMIN',
        correlationId: corr,
        fundKind: 'USER_OWNED',
      };
      const debitMeta: LedgerWriteMeta = {
        idempotencyKey: dto.idempotencyKey,
        description: dto.reason,
        actorUserId: actor.id,
        source: 'ADMIN',
        correlationId: corr,
      };
      const entry = amount >= 0n
        ? await this.balance.credit(tx, target.id, amount, 'ADMIN_ADJUSTMENT', creditMeta)
        : await this.balance.debit(tx, target.id, -amount, 'ADMIN_ADJUSTMENT', {
          ...debitMeta,
          allowNegative: true,
        });
      await tx.auditLog.create({
        data: {
          actorId: actor.id, action: 'BALANCE_ADJUST', entity: 'User', entityId: target.id.toString(),
          metadata: {
            onixId: formatOnixId(target.onixId),
            amountCents: dto.amountCents,
            idempotencyKey: dto.idempotencyKey,
            previousBalanceCents: target.balanceCents.toString(),
            actorOnixId: formatOnixId(actor.onixId),
            correlationId: corr,
            ...(dto.reason ? { reason: dto.reason } : {}),
          },
        },
      });
      return entry;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async countOtherPrivilegedAdmins(excludeUserId: bigint): Promise<number> {
    return this.prisma.user.count({
      where: {
        deletedAt: null,
        id: { not: excludeUserId },
        OR: [
          { isAdmin: true },
          { platformStatus: 'ADMIN' },
          { platformStatus: 'SUPER_ADMIN' },
        ],
      },
    });
  }

  private async countOtherSuperAdmins(excludeUserId: bigint): Promise<number> {
    return this.prisma.user.count({
      where: {
        deletedAt: null,
        id: { not: excludeUserId },
        platformStatus: 'SUPER_ADMIN',
      },
    });
  }

  private async assertNotLastPrivilegedAdmin(target: {
    id: bigint;
    isAdmin: boolean;
    platformStatus: PlatformStatus;
  }, actionLabel: string) {
    if (!isPrivilegedAdmin(target)) return;
    const others = await this.countOtherPrivilegedAdmins(target.id);
    if (others < 1) {
      throw new BadRequestException(`Нельзя ${actionLabel} последнего администратора платформы.`);
    }
  }

  private async assertActorIsSuperAdmin(actorId: bigint): Promise<void> {
    const actorRow = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { platformStatus: true, isAdmin: true },
    });
    if (!actorRow || !isSuperAdminStatus(actorRow.platformStatus)) {
      throw new ForbiddenException('Назначение и снятие ADMIN доступно только SUPER_ADMIN.');
    }
  }

  async ban(actor: AuthUser, onixId: string, dto: BanDto) {
    const resolved = await requireUserByOnixId(this.prisma, onixId);
    const displayId = formatOnixId(resolved.onixId);
    if (dto.banned) {
      if (!dto.reason) throw new BadRequestException('Укажите причину блокировки.');
      const comment = dto.comment?.trim();
      if (!comment) throw new BadRequestException('Комментарий администратора обязателен.');
      await this.assertNotLastPrivilegedAdmin(resolved, 'заблокировать');
      let days: number | null;
      try {
        days = banDurationDays(dto.reason, dto.durationDays);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      const now = new Date();
      const bannedUntil = days == null ? null : new Date(now.getTime() + days * 86400_000);
      const previous = {
        platformStatus: resolved.platformStatus,
        isAdmin: resolved.isAdmin,
        isSupport: resolved.isSupport,
        deletedAt: resolved.deletedAt?.toISOString() ?? null,
      };
      const user = await this.prisma.user.update({
        where: { id: resolved.id },
        data: {
          deletedAt: now,
          banReason: dto.reason,
          banComment: comment.slice(0, 1000),
          bannedAt: now,
          bannedUntil,
        },
      });
      await this.risk.recordBanMarkers(this.prisma, user.id);
      await this.prisma.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'USER_BAN',
          entity: 'User',
          entityId: user.id.toString(),
          metadata: {
            onixId: displayId,
            reason: dto.reason,
            reasonLabel: BAN_REASON_LABELS[dto.reason],
            comment,
            bannedUntil: bannedUntil?.toISOString() ?? null,
            permanent: bannedUntil == null,
            previous,
            actorOnixId: formatOnixId(actor.onixId),
          },
        },
      });
      return { onixId: displayId, banned: true, ban: banPublicInfo(user) };
    }

    const previous = {
      platformStatus: resolved.platformStatus,
      isAdmin: resolved.isAdmin,
      isSupport: resolved.isSupport,
      banReason: resolved.banReason,
      bannedUntil: resolved.bannedUntil?.toISOString() ?? null,
    };
    const user = await this.prisma.user.update({
      where: { id: resolved.id },
      data: { ...BAN_CLEAR_DATA },
    });
    await this.risk.revokeBanMarkers(this.prisma, user.id);
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'USER_UNBAN',
        entity: 'User',
        entityId: user.id.toString(),
        metadata: {
          onixId: displayId,
          previous,
          actorOnixId: formatOnixId(actor.onixId),
        },
      },
    });
    return { onixId: displayId, banned: false, ban: null };
  }

  /**
   * Assign public platform status.
   * Hierarchy: SUPER_ADMIN → may grant/revoke ADMIN|SUPER_ADMIN;
   * ADMIN → moderation statuses only (USER / VERIFIED_SELLER / MODERATOR / VIP).
   */
  async setPlatformStatus(actor: AuthUser, onixId: string, status: PlatformStatus) {
    if (!isPlatformStatus(status)) {
      throw new BadRequestException('Некорректный статус.');
    }
    const resolved = await requireUserByOnixId(this.prisma, onixId);
    const displayId = formatOnixId(resolved.onixId);
    const flags = flagsFromPlatformStatus(status);
    const targetPrivileged = isPrivilegedAdmin(resolved);
    const nextPrivileged = flags.isAdmin;
    const touchesAdminLadder = targetPrivileged || nextPrivileged
      || status === 'ADMIN' || status === 'SUPER_ADMIN'
      || resolved.platformStatus === 'ADMIN' || resolved.platformStatus === 'SUPER_ADMIN';

    if (touchesAdminLadder) {
      await this.assertActorIsSuperAdmin(actor.id);
    }

    if (resolved.id === actor.id && isPrivilegedAdmin(resolved) && !nextPrivileged) {
      throw new BadRequestException('Нельзя снять ADMIN/SUPER_ADMIN с собственного аккаунта.');
    }
    if (resolved.id === actor.id && isSuperAdminStatus(resolved.platformStatus) && status !== 'SUPER_ADMIN') {
      const others = await this.countOtherSuperAdmins(resolved.id);
      if (others < 1) {
        throw new BadRequestException('Нельзя снять статус SUPER_ADMIN с единственного root-админа.');
      }
    }
    if (targetPrivileged && !nextPrivileged) {
      await this.assertNotLastPrivilegedAdmin(resolved, 'снять статус ADMIN у');
    }
    if (isSuperAdminStatus(resolved.platformStatus) && status !== 'SUPER_ADMIN') {
      const others = await this.countOtherSuperAdmins(resolved.id);
      if (others < 1) {
        throw new BadRequestException('Нельзя снять статус SUPER_ADMIN с единственного root-админа.');
      }
    }

    const previous = {
      platformStatus: resolved.platformStatus,
      isAdmin: resolved.isAdmin,
      isSupport: resolved.isSupport,
    };
    const user = await this.prisma.user.update({
      where: { id: resolved.id },
      data: {
        platformStatus: status,
        isAdmin: flags.isAdmin,
        isSupport: flags.isSupport,
        permissionVersion: { increment: 1 },
      },
      select: {
        onixId: true, platformStatus: true, isAdmin: true, isSupport: true,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'USER_STATUS_SET',
        entity: 'User',
        entityId: resolved.id.toString(),
        metadata: {
          onixId: displayId,
          status,
          previous,
          next: {
            platformStatus: user.platformStatus,
            isAdmin: user.isAdmin,
            isSupport: user.isSupport,
          },
          actorOnixId: formatOnixId(actor.onixId),
          at: new Date().toISOString(),
        },
      },
    });
    return {
      onixId: formatOnixId(user.onixId),
      status: user.platformStatus,
      isAdmin: user.isAdmin,
      isSupport: user.isSupport,
    };
  }

  /** Block listing/selling without locking the whole account. */
  async setSellBan(actor: AuthUser, onixId: string, banned: boolean, comment?: string) {
    const resolved = await requireUserByOnixId(this.prisma, onixId);
    const displayId = formatOnixId(resolved.onixId);
    if (banned) {
      const note = comment?.trim();
      if (!note) throw new BadRequestException('Комментарий администратора обязателен.');
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: resolved.id },
          data: { sellBannedAt: now },
        });
        await tx.product.updateMany({
          where: { sellerId: resolved.id, status: 'ACTIVE' },
          data: { status: 'ARCHIVED' },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'USER_SELL_BAN',
            entity: 'User',
            entityId: resolved.id.toString(),
            metadata: { comment: note.slice(0, 1000) },
          },
        });
      });
      return { onixId: displayId, sellBanned: true as const };
    }
    await this.prisma.user.update({
      where: { id: resolved.id },
      data: { sellBannedAt: null },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'USER_SELL_UNBAN',
        entity: 'User',
        entityId: resolved.id.toString(),
      },
    });
    return { onixId: displayId, sellBanned: false as const };
  }

  /** Slice 6 — security-review flags for admin plane (YELLOW, not ban). */
  async securityFlags(onixId: string) {
    const resolved = await requireUserByOnixId(this.prisma, onixId);
    const yellow = await this.withdrawVelocity.resolveAccountSaleProtectionFlag(resolved.id);
    return {
      onixId: formatOnixId(resolved.onixId),
      userId: resolved.id.toString(),
      flags: yellow ? [yellow] : [],
    };
  }

  async withdraw(user: AuthUser, dto: WithdrawalDto, correlationId?: string) {
    // Stage 1: no external payout rail — keep debit disabled until WITHDRAWALS_ENABLED=true.
    const enabled = (process.env.WITHDRAWALS_ENABLED ?? '').trim().toLowerCase();
    if (enabled !== '1' && enabled !== 'true' && enabled !== 'yes') {
      throw new BadRequestException(
        'Вывод средств временно недоступен. Обратитесь в поддержку ONIX.',
      );
    }

    const corr = correlationId ?? resolveCorrelationId();
    const amount = BigInt(dto.amountCents);

    // Risk/MFA before money move (outside TX — may create MfaChallenge / wait for Telegram).
    await this.riskEngine.assertWithdrawAllowed({
      userId: user.id,
      amountCents: amount,
      sessionId: user.sessionId,
      stepUpChallengeId: dto.stepUpChallengeId,
    });

    // Idempotency first: completed retries return without velocity/debit.
    // Velocity runs inside the Serializable TX under User FOR UPDATE (no parallel bypass).
    const result = await this.idempotency.runTransactional(
      'wallet.withdraw',
      dto.idempotencyKey,
      { userId: user.id.toString(), amountCents: dto.amountCents },
      async (tx) => {
        const assertInput: WithdrawAssertInput = {
          userId: user.id,
          amountCents: amount,
          db: tx,
          lockUser: true,
          excludeIdempotencyKey: dto.idempotencyKey,
        };
        await this.withdrawVelocity.assertAllowed(assertInput);

        // Open clawbacks consume available balance before any payout rail debit.
        await this.clawbacks.recoverAllForSeller(tx, user.id);
        if (await this.clawbacks.hasOpenDebt(tx, user.id)) {
          throw new BadRequestException(
            'Вывод недоступен: есть непогашенный clawback по возврату сделки. Пополните баланс или обратитесь в поддержку.',
          );
        }
        const entry = await this.balance.debit(tx, user.id, amount, 'WITHDRAWAL', {
          idempotencyKey: dto.idempotencyKey,
          description: 'Заявка пользователя на вывод средств',
          actorUserId: user.id,
          source: 'USER',
          correlationId: corr,
        });
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: 'WALLET_WITHDRAWAL_REQUEST',
            entity: 'LedgerEntry',
            entityId: entry.id.toString(),
            metadata: {
              amountCents: dto.amountCents,
              idempotencyKey: dto.idempotencyKey,
              correlationId: corr,
            },
          },
        });
        return {
          id: entry.id.toString(),
          amountCents: entry.amountCents.toString(),
          balanceAfterCents: entry.balanceAfterCents.toString(),
          type: entry.type,
        };
      },
      { userId: user.id },
    );
    return result.value;
  }
}

@Controller('wallet')
class WalletController {
  constructor(private readonly service: OperationsService) {}
  @Post('withdrawals')
  withdraw(@CurrentUser() user: AuthUser, @Body() dto: WithdrawalDto, @Req() req: Request) {
    return this.service.withdraw(user, dto, resolveCorrelationId(req));
  }
}

@Controller('health')
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coordination: SharedCoordinationService,
  ) {}

  @Public()
  @Get('live')
  @Header('Cache-Control', 'no-store')
  live() {
    const info = buildInfo();
    return {
      status: 'ok',
      service: info.service,
      version: info.version,
      commit: info.commitShort,
      region: info.region,
    };
  }

  @Public()
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    const [, coordinationReady] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`,
      this.coordination.isHealthy(),
    ]);
    if (!coordinationReady) {
      throw new Error('Shared coordination is not ready.');
    }
    const info = buildInfo();
    return {
      status: 'ready',
      database: 'ok',
      coordination: this.coordination.backend,
      version: info.version,
      commit: info.commitShort,
    };
  }

  /**
   * Network path probe (RU / CDN / rewrite debugging).
   * No secrets — hostname, region, response time only.
   */
  @Public()
  @Get('network')
  @Header('Cache-Control', 'no-store')
  network(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!debugEndpointsEnabled()) throw new NotFoundException();
    const started = performance.now();
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedIp = typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : Array.isArray(forwarded) ? forwarded[0] : undefined;
    const region = process.env.RENDER_REGION
      ?? process.env.AWS_REGION
      ?? process.env.FLY_REGION
      ?? 'frankfurt';
    const responseTimeMs = Math.round((performance.now() - started) * 1000) / 1000;
    res.setHeader('X-Response-Time', `${responseTimeMs}ms`);
    res.setHeader(
      'Server-Timing',
      `network;dur=${responseTimeMs}`,
    );
    return {
      status: 'ok',
      hostname: osHostname(),
      region,
      responseTimeMs,
      timestamp: new Date().toISOString(),
      // Client-facing path hints (no secrets)
      via: {
        host: req.headers.host ?? null,
        forwardedFor: forwardedIp || null,
        vercelId: typeof req.headers['x-vercel-id'] === 'string' ? req.headers['x-vercel-id'] : null,
        cfRay: typeof req.headers['cf-ray'] === 'string' ? req.headers['cf-ray'] : null,
      },
    };
  }

  /**
   * Full hop debug for RU ERR_CONNECTION_RESET vs /products.
   * No secrets — cookie size only, never token values.
   */
  @Public()
  @Get('route-debug')
  @Header('Cache-Control', 'no-store')
  routeDebug(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!debugEndpointsEnabled()) throw new NotFoundException();
    const t0 = performance.now();
    const cookieHeader = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedIp = typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : Array.isArray(forwarded) ? forwarded[0] : undefined;
    const requestId = typeof req.headers['x-request-id'] === 'string'
      ? req.headers['x-request-id']
      : null;
    const body = {
      requestId,
      cfRay: typeof req.headers['cf-ray'] === 'string' ? req.headers['cf-ray'] : null,
      cfConnectingIp: typeof req.headers['cf-connecting-ip'] === 'string'
        ? req.headers['cf-connecting-ip']
        : null,
      forwarded: forwardedIp || null,
      host: typeof req.headers.host === 'string' ? req.headers.host : null,
      origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      cookieSize: cookieHeader.length,
      region: process.env.RENDER_REGION
        ?? process.env.AWS_REGION
        ?? process.env.FLY_REGION
        ?? 'frankfurt',
      timestamp: new Date().toISOString(),
    };
    const dur = performance.now() - t0;
    const existing = res.getHeader('Server-Timing');
    const metric = `controller;dur=${dur.toFixed(1)}, db;dur=0`;
    if (typeof existing === 'string' && existing.length > 0) {
      res.setHeader('Server-Timing', `${existing}, ${metric}`);
    } else {
      res.setHeader('Server-Timing', metric);
    }
    res.setHeader('X-Response-Time', `${dur.toFixed(1)}ms`);
    return body;
  }
}

@Module({
  // Privileged operations are exposed only by AdminModule with separate admin sessions.
  controllers: [HealthController, WalletController],
  providers: [OperationsService],
  imports: [CoordinationModule, EscrowModule, AuthV2Module, EconomyModule, RiskModule],
})
export class OperationsModule {}
