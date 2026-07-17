import {
  BadRequestException, Body, CanActivate, Controller, ExecutionContext, ForbiddenException,
  Get, Header, Injectable, NotFoundException, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min,
} from 'class-validator';
import type { PaymentProviderCode, PaymentWallet, SellerVerificationKind } from '@prisma/client';
import { AuthRequest, AuthUser, CurrentUser, parseId } from '../common';
import { PrismaService } from '../prisma.service';
import { AnalyticsFoundationService } from './analytics/analytics-foundation.service';
import { PaymentsService } from './payments/payments.service';
import { ProSubscriptionService } from './pro/pro.service';
import { TrustService } from './trust/trust.service';
import { VerificationService } from './verification/verification.service';
import { WalletEconomyService } from './wallet/wallet-economy.service';

class CreatePaymentIntentDto {
  @IsIn(['MAIN', 'DEPOSIT']) wallet!: PaymentWallet;
  @Type(() => Number) @IsInt() @Min(100) @Max(50_000_000) amountCents!: number;
  @IsIn(['MANUAL', 'YOOKASSA', 'TELEGRAM_WALLET', 'CRYPTO', 'CARD', 'STRIPE'])
  provider!: PaymentProviderCode;
  @IsString() @Length(16, 100) idempotencyKey!: string;
}

class WithdrawDepositDto {
  @Type(() => Number) @IsInt() @Min(100) @Max(50_000_000) amountCents!: number;
  @IsString() @Length(16, 100) idempotencyKey!: string;
}

class ConfirmVerificationDto {
  @IsOptional() @IsString() @MaxLength(2000) evidencePayload?: string;
  @IsOptional() @IsString() @MaxLength(191) providerRef?: string;
  @IsOptional() @IsBoolean() approve?: boolean;
}

class ProductViewDto {
  @IsOptional() @IsString() @MaxLength(64) fingerprintHash?: string;
  @IsOptional() @IsString() @MaxLength(512) userAgent?: string;
  @IsOptional() @IsString() @MaxLength(32) purpose?: string;
  @IsOptional() @IsBoolean() isPrefetch?: boolean;
}

class GrantProDto {
  @IsOptional() @IsString() endsAt?: string;
}

const VERIFICATION_KINDS: readonly SellerVerificationKind[] = [
  'PHONE_SMS', 'PHONE_CALL', 'PHONE_VOICE', 'PASSPORT', 'VOICE_IDENTITY',
];

function parseVerificationKind(kind: string): SellerVerificationKind {
  if (!(VERIFICATION_KINDS as readonly string[]).includes(kind)) {
    throw new BadRequestException('Неизвестный тип верификации.');
  }
  return kind as SellerVerificationKind;
}

@Controller()
export class EconomyController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly wallet: WalletEconomyService,
    private readonly verification: VerificationService,
    private readonly pro: ProSubscriptionService,
    private readonly analytics: AnalyticsFoundationService,
    private readonly trust: TrustService,
  ) {}

  @Post('payments/intents')
  createIntent(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentIntentDto) {
    return this.payments.createTopUp(user, dto);
  }

  @Post('payments/intents/:id/confirm')
  confirmIntent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.confirmManual(user, id);
  }

  @Get('payments/intents/:id')
  @Header('Cache-Control', 'private, no-store')
  getIntent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.getIntent(user, id);
  }

  @Get('wallet/deposit')
  @Header('Cache-Control', 'private, no-store')
  depositWallet(@CurrentUser() user: AuthUser) {
    return this.wallet.getDepositWallet(user);
  }

  @Get('wallet/deposit/ledger')
  @Header('Cache-Control', 'private, no-store')
  depositLedger(@CurrentUser() user: AuthUser) {
    return this.wallet.listDepositLedger(user);
  }

  @Get('wallet/deposit/locks')
  @Header('Cache-Control', 'private, no-store')
  depositLocks(@CurrentUser() user: AuthUser) {
    return this.wallet.listLocks(user);
  }

  @Post('wallet/deposit/withdrawals')
  withdrawDeposit(@CurrentUser() user: AuthUser, @Body() dto: WithdrawDepositDto) {
    return this.wallet.withdrawDeposit(user, dto.amountCents, dto.idempotencyKey);
  }

  @Get('users/me/trust')
  @Header('Cache-Control', 'private, no-store')
  myTrust(@CurrentUser() user: AuthUser) {
    return this.wallet.getOwnerTrust(user);
  }

  @Get('users/me/trust/history')
  @Header('Cache-Control', 'private, no-store')
  async myTrustHistory(@CurrentUser() user: AuthUser) {
    const full = await this.wallet.getOwnerTrust(user);
    return full.history;
  }

  @Post('users/me/trust/recompute')
  recomputeTrust(@CurrentUser() user: AuthUser) {
    return this.trust.recompute(user.id);
  }

  /** Public trust card — models/API only (no final UI in Stage 1). */
  @Get('users/:onixId/trust-card')
  @Header('Cache-Control', 'private, no-store')
  trustCard(@Param('onixId') onixId: string) {
    return this.wallet.getPublicTrustCard(onixId);
  }

  @Get('users/me/verifications')
  @Header('Cache-Control', 'private, no-store')
  listVerifications(@CurrentUser() user: AuthUser) {
    return this.verification.list(user.id);
  }

  @Post('users/me/verifications/:kind/start')
  startVerification(@CurrentUser() user: AuthUser, @Param('kind') kind: string) {
    return this.verification.start(user, parseVerificationKind(kind));
  }

  @Post('users/me/verifications/:kind/confirm')
  confirmVerification(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Body() dto: ConfirmVerificationDto,
    @Query('userId') targetUserId?: string,
  ) {
    const uid = targetUserId && (user.isAdmin || user.isSupport)
      ? parseId(targetUserId, 'userId')
      : user.id;
    return this.verification.confirm(user, uid, parseVerificationKind(kind), dto);
  }

  @Get('users/me/pro')
  @Header('Cache-Control', 'private, no-store')
  myPro(@CurrentUser() user: AuthUser) {
    return this.pro.getStatus(user.id);
  }

  @Post('products/:id/views')
  recordView(
    @CurrentUser() user: AuthUser,
    @Param('id') productId: string,
    @Body() dto: ProductViewDto,
  ) {
    return this.analytics.recordUniqueProductView({
      productId,
      viewerUserId: user.id,
      fingerprintHash: dto.fingerprintHash,
      userAgent: dto.userAgent,
      purpose: dto.purpose,
      isPrefetch: dto.isPrefetch,
    });
  }
}

@Injectable()
class EconomyAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!context.switchToHttp().getRequest<AuthRequest>().user?.isAdmin) {
      throw new ForbiddenException('Требуются права администратора ONIX.');
    }
    return true;
  }
}

@Controller('admin')
@UseGuards(EconomyAdminGuard)
export class AdminEconomyController {
  constructor(
    private readonly pro: ProSubscriptionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('users/:onixId/pro/grant')
  async grantPro(
    @CurrentUser() actor: AuthUser,
    @Param('onixId') onixId: string,
    @Body() body: GrantProDto,
  ) {
    const user = await this.prisma.user.findUnique({ where: { onixId }, select: { id: true } });
    if (!user) throw new NotFoundException('Пользователь не найден.');
    return this.pro.grant(actor, user.id, body.endsAt ? new Date(body.endsAt) : undefined);
  }

  @Post('users/:onixId/pro/revoke')
  async revokePro(@CurrentUser() actor: AuthUser, @Param('onixId') onixId: string) {
    const user = await this.prisma.user.findUnique({ where: { onixId }, select: { id: true } });
    if (!user) throw new NotFoundException('Пользователь не найден.');
    return this.pro.revoke(actor, user.id);
  }
}
