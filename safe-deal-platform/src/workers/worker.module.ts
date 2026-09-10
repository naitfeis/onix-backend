import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module';
import { EconomyModule } from '../economy/economy.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { ObservabilityModule } from '../observability/observability.module';
import { DepositUnlockJob } from './jobs/deposit-unlock.job';
import { TrustRecomputeJob } from './jobs/trust-recompute.job';
import { IdempotencyCleanupJob } from './jobs/idempotency-cleanup.job';
import { PaymentIntentExpireJob } from './jobs/payment-intent-expire.job';
import { LedgerReconciliationJob } from './jobs/ledger-reconciliation.job';
import { PaymentReconciliationJob } from './jobs/payment-reconciliation.job';
import { ClawbackRecoverJob } from './jobs/clawback-recover.job';
import { SecurityIpRetentionJob } from './jobs/security-ip-retention.job';
import { ShadowListingJob } from './jobs/shadow-listing.job';
import { TelegramOutboxJob } from './jobs/telegram-outbox.job';
import { DisputeSlaJob } from './jobs/dispute-sla.job';
import { WorkerLockService } from './worker-lock.service';
import { WorkerRunnerService } from './worker-runner.service';

/**
 * Background worker process — no HTTP controllers, no AuthGuard.
 * Start with: node dist/worker.main.js
 */
@Module({
  imports: [DatabaseModule, ObservabilityModule, IdempotencyModule, EconomyModule],
  providers: [
    WorkerLockService,
    DepositUnlockJob,
    TrustRecomputeJob,
    IdempotencyCleanupJob,
    PaymentIntentExpireJob,
    LedgerReconciliationJob,
    PaymentReconciliationJob,
    ClawbackRecoverJob,
    SecurityIpRetentionJob,
    ShadowListingJob,
    TelegramOutboxJob,
    DisputeSlaJob,
    WorkerRunnerService,
  ],
})
export class WorkerModule {}
