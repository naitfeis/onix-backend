import { Module } from '@nestjs/common';
import { EconomyController } from './economy.controller';
import { AnalyticsFoundationService } from './analytics/analytics-foundation.service';
import { SellerAnalyticsService } from './analytics/seller-analytics.service';
import { ManualPaymentProvider } from './payments/manual.provider';
import { TinkoffAcquiringProvider } from './payments/tinkoff.provider';
import { PaymentsService } from './payments/payments.service';
import { ProSubscriptionService } from './pro/pro.service';
import { TrustService } from './trust/trust.service';
import { BalanceService } from './wallet/balance.service';
import { ClawbackService } from './wallet/clawback.service';
import { DepositService } from './wallet/deposit.service';
import { LockService } from './wallet/lock.service';
import { WalletEconomyService } from './wallet/wallet-economy.service';
import { WithdrawVelocityService } from './wallet/withdraw-velocity';

@Module({
  controllers: [EconomyController],
  providers: [
    ManualPaymentProvider,
    TinkoffAcquiringProvider,
    PaymentsService,
    BalanceService,
    ClawbackService,
    DepositService,
    LockService,
    WalletEconomyService,
    WithdrawVelocityService,
    TrustService,
    ProSubscriptionService,
    AnalyticsFoundationService,
    SellerAnalyticsService,
  ],
  exports: [
    BalanceService,
    ClawbackService,
    DepositService,
    LockService,
    TrustService,
    PaymentsService,
    ProSubscriptionService,
    AnalyticsFoundationService,
    SellerAnalyticsService,
    WithdrawVelocityService,
  ],
})
export class EconomyModule {}
