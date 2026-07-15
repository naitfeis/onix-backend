import {
  BadRequestException, Body, CanActivate, ConflictException, Controller, ExecutionContext,
  ForbiddenException, Get, Injectable, Module, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
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
class BanDto { @IsBoolean() banned!: boolean; }
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
  async ban(actor: AuthUser, onixId: string, banned: boolean) {
    const user = await this.prisma.user.update({ where: { onixId }, data: { deletedAt: banned ? new Date() : null } });
    if (banned) {
      await this.risk.recordBanMarkers(this.prisma, user.id);
    } else {
      await this.risk.revokeBanMarkers(this.prisma, user.id);
    }
    await this.prisma.auditLog.create({
      data: { actorId: actor.id, action: banned ? 'USER_BAN' : 'USER_UNBAN', entity: 'User', entityId: user.id.toString() },
    });
    return { onixId, banned };
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
    return this.service.ban(actor, id, dto.banned);
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
  @Public() @Get('live') live() { return { status: 'ok', service: 'onix-api' }; }
  @Public() @Get('ready') async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ready', database: 'ok' };
  }
}

@Module({
  controllers: [AdminController, AdminRefundController, SupportOpsController, HealthController, WalletController],
  providers: [AdminGuard, SupportGuard, OperationsService],
  imports: [EscrowModule, AuthV2Module],
})
export class OperationsModule {}
