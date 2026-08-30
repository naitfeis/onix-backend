import {
  Body, CanActivate, Controller, ExecutionContext, ForbiddenException,
  Get, Header, Injectable, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min,
} from 'class-validator';
import type { PaymentProviderCode, PaymentWallet } from '@prisma/client';
import { AuthRequest, AuthUser, CurrentUser } from '../common';
import { PrismaService } from '../prisma.service';
import { requireUserByOnixId } from '../onix-id-lookup';
import { assertRateLimit } from '../rate-limit';
import { AnalyticsFoundationService } from './analytics/analytics-foundation.service';
import { SellerAnalyticsService } from './analytics/seller-analytics.service';
import { PaymentsService } from './payments/payments.service';
import { ProSubscriptionService } from './pro/pro.service';
import { TrustService } from './trust/trust.service';
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

class FundDepositDto {
  @Type(() => Number) @IsInt() @Min(100) @Max(50_000_000) amountCents!: number;
  @IsString() @Length(16, 100) idempotencyKey!: string;
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

class SellerAnalyticsQueryDto {
  /** 0 = current Mon–Sun week, -1 = previous week, … (max -52). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(-52) @Max(0) weekOffset?: number;
}

@Controller()
export class EconomyController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly wallet: WalletEconomyService,
    private readonly pro: ProSubscriptionService,
    private readonly analytics: AnalyticsFoundationService,
    private readonly sellerAnalytics: SellerAnalyticsService,
    private readonly trust: TrustService,
  ) {}

  @Post('payments/intents')
  createIntent(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentIntentDto) {
    assertRateLimit(`payment:create:${user.id}`, 30, 60_000);
    return this.payments.createTopUp(user, dto);
  }

  @Post('payments/intents/:id/confirm')
  confirmIntent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertRateLimit(`payment:confirm:${user.id}`, 30, 60_000);
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

  @Post('wallet/deposit/fund')
  fundDeposit(@CurrentUser() user: AuthUser, @Body() dto: FundDepositDto) {
    return this.wallet.fundDepositFromBalance(user, dto.amountCents, dto.idempotencyKey);
  }

  /** Canonical Stage 1 alias — Balance → Deposit (same as /fund). */
  @Post('wallet/deposit/topup')
  topupDeposit(@CurrentUser() user: AuthUser, @Body() dto: FundDepositDto) {
    return this.wallet.fundDepositFromBalance(user, dto.amountCents, dto.idempotencyKey);
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

  /** Owner seller analytics — weekly Mon–Sun series (Stage 2). */
  @Get('users/me/analytics')
  @Header('Cache-Control', 'private, no-store')
  myAnalytics(@CurrentUser() user: AuthUser, @Query() query: SellerAnalyticsQueryDto) {
    assertRateLimit(`analytics:${user.id}`, 20, 60_000);
    return this.sellerAnalytics.getOwnerAnalytics(user, query.weekOffset);
  }

  /** Public trust card — never includes trustScore. */
  @Get('users/:onixId/trust-card')
  @Header('Cache-Control', 'private, no-store')
  trustCard(@CurrentUser() user: AuthUser, @Param('onixId') onixId: string) {
    assertRateLimit(`trust-card:${user.id}`, 60, 60_000);
    return this.wallet.getPublicTrustCard(onixId);
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
    assertRateLimit(`view:${user.id}`, 60, 60_000);
    assertRateLimit(`view:${user.id}:${productId}`, 1, 10_000);
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
    const user = await requireUserByOnixId(this.prisma, onixId);
    return this.pro.grant(actor, user.id, body.endsAt ? new Date(body.endsAt) : undefined);
  }

  @Post('users/:onixId/pro/revoke')
  async revokePro(@CurrentUser() actor: AuthUser, @Param('onixId') onixId: string) {
    const user = await requireUserByOnixId(this.prisma, onixId);
    return this.pro.revoke(actor, user.id);
  }
}
