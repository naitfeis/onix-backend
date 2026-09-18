import { Module, forwardRef } from '@nestjs/common';
import { EscrowModule } from '../escrow.module';
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
import { ManualPayoutProvider } from './payouts/manual-payout.provider';
import { PayoutService } from './payouts/payout.service';
import { PAYOUT_PROVIDER } from './payouts/payout-provider';

@Module({
  imports: [forwardRef(() => EscrowModule)],
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
    ManualPayoutProvider,
    { provide: PAYOUT_PROVIDER, useExisting: ManualPayoutProvider },
    PayoutService,
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
    ManualPayoutProvider,
    PAYOUT_PROVIDER,
    PayoutService,
  ],
})
export class EconomyModule {}
