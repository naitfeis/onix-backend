import {
  Body, Controller, Get, Header, Param, Post, Query, Req, Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import type { PaymentProviderCode, PaymentWallet } from '@prisma/client';
import { AuthUser, CurrentUser, Public } from '../common';
import { assertRateLimit, DistributedRateLimiter } from '../rate-limit';
import { AnalyticsFoundationService } from './analytics/analytics-foundation.service';
import { SellerAnalyticsService } from './analytics/seller-analytics.service';
import { PaymentsService } from './payments/payments.service';
import { ProSubscriptionService } from './pro/pro.service';
import { TrustService } from './trust/trust.service';
import { WalletEconomyService } from './wallet/wallet-economy.service';

class CheckoutBindDto {
  @IsString() @Length(8, 64) productId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10_000) quantity!: number;
  @IsString() @Length(16, 100) purchaseIdempotencyKey!: string;
}

class CreatePaymentIntentDto {
  @IsIn(['MAIN', 'DEPOSIT']) wallet!: PaymentWallet;
  @Type(() => Number) @IsInt() @Min(100) @Max(50_000_000) amountCents!: number;
  @IsIn(['MANUAL', 'YOOKASSA', 'TELEGRAM_WALLET', 'CRYPTO', 'CARD', 'STRIPE'])
  provider!: PaymentProviderCode;
  @IsString() @Length(16, 100) idempotencyKey!: string;
  @IsOptional() @ValidateNested() @Type(() => CheckoutBindDto) checkout?: CheckoutBindDto;
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
    private readonly rateLimit: DistributedRateLimiter,
  ) {}

  @Post('payments/intents')
  async createIntent(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentIntentDto) {
    // Distributed: each intent reserves product stock for checkout, so a
    // per-instance budget would multiply that reservation capacity by N nodes.
    await this.rateLimit.assert(`payment:create:${user.id}`, 30, 60_000);
    return this.payments.createTopUp(user, dto);
  }

  @Public()
  @Get('payments/methods')
  @Header('Cache-Control', 'public, max-age=30')
  paymentMethods() {
    return this.payments.paymentMethodsPublic();
  }

  @Public()
  @Post('payments/tinkoff/notification')
  async tinkoffNotification(@Req() req: Request, @Res() res: Response) {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    await this.payments.handleProviderWebhook('YOOKASSA', req.headers, raw);
    res.type('text/plain').send('OK');
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
  async fundDeposit(@CurrentUser() user: AuthUser, @Body() dto: FundDepositDto) {
    await this.rateLimit.assert(`wallet:deposit:${user.id}`, 20, 60_000);
    return this.wallet.fundDepositFromBalance(user, dto.amountCents, dto.idempotencyKey);
  }

  /** Canonical Stage 1 alias — Balance → Deposit (same as /fund). */
  @Post('wallet/deposit/topup')
  async topupDeposit(@CurrentUser() user: AuthUser, @Body() dto: FundDepositDto) {
    await this.rateLimit.assert(`wallet:deposit:${user.id}`, 20, 60_000);
    return this.wallet.fundDepositFromBalance(user, dto.amountCents, dto.idempotencyKey);
  }

  @Post('wallet/deposit/withdrawals')
  async withdrawDeposit(@CurrentUser() user: AuthUser, @Body() dto: WithdrawDepositDto) {
    await this.rateLimit.assert(`wallet:deposit:${user.id}`, 20, 60_000);
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
    assertRateLimit(`view:${user.id}:${productId}`, 8, 60_000);
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
