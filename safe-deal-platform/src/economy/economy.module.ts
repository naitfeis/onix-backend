import { Module } from '@nestjs/common';
import { AdminEconomyController, EconomyController } from './economy.controller';
import { AnalyticsFoundationService } from './analytics/analytics-foundation.service';
import { SellerAnalyticsService } from './analytics/seller-analytics.service';
import { ManualPaymentProvider } from './payments/manual.provider';
import { PaymentsService } from './payments/payments.service';
import { ProSubscriptionService } from './pro/pro.service';
import { TrustService } from './trust/trust.service';
import { VerificationService } from './verification/verification.service';
import { BalanceService } from './wallet/balance.service';
import { ClawbackService } from './wallet/clawback.service';
import { DepositService } from './wallet/deposit.service';
import { LockService } from './wallet/lock.service';
import { WalletEconomyService } from './wallet/wallet-economy.service';

@Module({
  controllers: [EconomyController, AdminEconomyController],
  providers: [
    ManualPaymentProvider,
    PaymentsService,
    BalanceService,
    ClawbackService,
    DepositService,
    LockService,
    WalletEconomyService,
    TrustService,
    VerificationService,
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
    VerificationService,
    ProSubscriptionService,
    AnalyticsFoundationService,
    SellerAnalyticsService,
  ],
})
export class EconomyModule {}
