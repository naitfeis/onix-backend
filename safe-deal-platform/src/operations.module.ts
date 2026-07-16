import {
  BadRequestException, Body, CanActivate, ConflictException, Controller, ExecutionContext,
  ForbiddenException, Get, Header, Injectable, Module, Param, Patch, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import { BanReason, Prisma } from '@prisma/client';
import {
  IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request, Response } from 'express';
import { hostname as osHostname } from 'node:os';
import { BAN_CLEAR_DATA, BAN_REASON_LABELS, banDurationDays, banPublicInfo } from './ban-policy';
import { AuthRequest, AuthUser, CurrentUser, Public, canActAsSupport, parseId } from './common';
import { AuthV2Module } from './auth-v2/auth-v2.module';
import { EscrowModule, EscrowService } from './escrow.module';
import { PrismaService } from './prisma.service';
import { RiskScoreService } from './risk-score.service';

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
class RefundDto { @IsOptional() @IsString() @MaxLength(1000) reason?: string; }
class WithdrawalDto {
  @IsString() @Matches(/^[1-9]\d*$/) amountCents!: string;
  @IsString() @Length(16, 100) idempotencyKey!: string;
}

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!context.switchToHttp().getRequest<AuthRequest>().user?.isAdmin) {
      throw new ForbiddenException('Требуются права администратора ONIX.');
    }
    return true;
  }
}

/** Admin or SUPPORT staff — Escrow refund only (no direct balance edits). */
@Injectable()
class SupportGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthRequest>().user;
    if (!user || !canActAsSupport(user)) {
      throw new ForbiddenException('Требуются права поддержки ONIX.');
    }
    return true;
  }
}

@Injectable()
class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly risk: RiskScoreService,
  ) {}

  adjust(actor: AuthUser, onixId: string, dto: BalanceDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (existing) return existing;
      const target = await tx.user.findUniqueOrThrow({ where: { onixId } });
      const amount = BigInt(dto.amountCents);
      const user = await tx.user.update({
        where: { id: target.id },
        data: { balanceCents: amount >= 0n ? { increment: amount } : { decrement: -amount } },
      });
      if (user.balanceCents < 0n) throw new ForbiddenException('Корректировка создаёт отрицательный баланс.');
      const entry = await tx.ledgerEntry.create({
        data: {
          userId: user.id, type: 'ADMIN_ADJUSTMENT', amountCents: amount,
          balanceAfterCents: user.balanceCents, idempotencyKey: dto.idempotencyKey,
          description: dto.reason,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id, action: 'BALANCE_ADJUST', entity: 'User', entityId: user.id.toString(),
          metadata: { amountCents: dto.amountCents, idempotencyKey: dto.idempotencyKey, ...(dto.reason ? { reason: dto.reason } : {}) },
        },
      });
      return entry;
    });
  }

  async ban(actor: AuthUser, onixId: string, dto: BanDto) {
    if (dto.banned) {
      if (!dto.reason) throw new BadRequestException('Укажите причину блокировки.');
      const comment = dto.comment?.trim();
      if (!comment) throw new BadRequestException('Комментарий администратора обязателен.');
      let days: number | null;
      try {
        days = banDurationDays(dto.reason, dto.durationDays);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      const now = new Date();
      const bannedUntil = days == null ? null : new Date(now.getTime() + days * 86400_000);
      const user = await this.prisma.user.update({
        where: { onixId },
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
            reason: dto.reason,
            reasonLabel: BAN_REASON_LABELS[dto.reason],
            comment,
            bannedUntil: bannedUntil?.toISOString() ?? null,
            permanent: bannedUntil == null,
          },
        },
      });
      return { onixId, banned: true, ban: banPublicInfo(user) };
    }

    const user = await this.prisma.user.update({
      where: { onixId },
      data: { ...BAN_CLEAR_DATA },
    });
    await this.risk.revokeBanMarkers(this.prisma, user.id);
    await this.prisma.auditLog.create({
      data: { actorId: actor.id, action: 'USER_UNBAN', entity: 'User', entityId: user.id.toString() },
    });
    return { onixId, banned: false, ban: null };
  }

  withdraw(user: AuthUser, dto: WithdrawalDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      const amount = BigInt(dto.amountCents);
      if (existing) {
        if (existing.userId !== user.id || existing.type !== 'WITHDRAWAL' || existing.amountCents !== -amount) {
          throw new ConflictException('Ключ идемпотентности уже использован для другой операции.');
        }
        return existing;
      }
      const debited = await tx.user.updateMany({
        where: { id: user.id, deletedAt: null, balanceCents: { gte: amount } },
        data: { balanceCents: { decrement: amount } },
      });
      if (!debited.count) throw new BadRequestException('Недостаточно средств для вывода.');
      const account = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const entry = await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          type: 'WITHDRAWAL',
          amountCents: -amount,
          balanceAfterCents: account.balanceCents,
          idempotencyKey: dto.idempotencyKey,
          description: 'Заявка пользователя на вывод средств',
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'WALLET_WITHDRAWAL_REQUEST',
          entity: 'LedgerEntry',
          entityId: entry.id.toString(),
          metadata: { amountCents: dto.amountCents, idempotencyKey: dto.idempotencyKey },
        },
      });
      return entry;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

@Controller('wallet')
class WalletController {
  constructor(private readonly service: OperationsService) {}
  @Post('withdrawals')
  withdraw(@CurrentUser() user: AuthUser, @Body() dto: WithdrawalDto) {
    return this.service.withdraw(user, dto);
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
class AdminController {
  constructor(private readonly service: OperationsService) {}
  @Post('users/:onixId/balance')
  balance(@CurrentUser() actor: AuthUser, @Param('onixId') id: string, @Body() dto: BalanceDto) {
    return this.service.adjust(actor, id, dto);
  }
  @Patch('users/:onixId/ban')
  ban(@CurrentUser() actor: AuthUser, @Param('onixId') id: string, @Body() dto: BanDto) {
    return this.service.ban(actor, id, dto);
  }
}

@Controller('support')
@UseGuards(SupportGuard)
class SupportOpsController {
  constructor(private readonly escrow: EscrowService) {}

  /** Refund via Escrow ledger only (incl. COMPLETED clawback). */
  @Post('orders/:id/refund')
  refund(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: RefundDto) {
    return this.escrow.refundByAdmin(actor, parseId(id), dto.reason);
  }
}

/** Backward-compatible admin refund path (same Escrow service). */
@Controller('admin')
@UseGuards(SupportGuard)
class AdminRefundController {
  constructor(private readonly escrow: EscrowService) {}
  @Post('orders/:id/refund')
  refund(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: RefundDto) {
    return this.escrow.refundByAdmin(actor, parseId(id), dto.reason);
  }
}

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('live')
  @Header('Cache-Control', 'no-store')
  live() { return { status: 'ok', service: 'onix-api' }; }

  @Public()
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ready', database: 'ok' };
  }

  /**
   * Network path probe (RU / CDN / rewrite debugging).
   * No secrets — hostname, region, response time only.
   */
  @Public()
  @Get('network')
  @Header('Cache-Control', 'no-store')
  network(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
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
  controllers: [AdminController, AdminRefundController, SupportOpsController, HealthController, WalletController],
  providers: [AdminGuard, SupportGuard, OperationsService],
  imports: [EscrowModule, AuthV2Module],
})
export class OperationsModule {}
