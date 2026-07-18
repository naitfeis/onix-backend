import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module';
import { EconomyModule } from '../economy/economy.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { ObservabilityModule } from '../observability/observability.module';
import { DepositUnlockJob } from './jobs/deposit-unlock.job';
import { TrustRecomputeJob } from './jobs/trust-recompute.job';
import { IdempotencyCleanupJob } from './jobs/idempotency-cleanup.job';
import { PaymentIntentExpireJob } from './jobs/payment-intent-expire.job';
import { WorkerRunnerService } from './worker-runner.service';

/**
 * Background worker process — no HTTP controllers, no AuthGuard.
 * Start with: node dist/worker.main.js
 */
@Module({
  imports: [DatabaseModule, ObservabilityModule, IdempotencyModule, EconomyModule],
  providers: [
    DepositUnlockJob,
    TrustRecomputeJob,
    IdempotencyCleanupJob,
    PaymentIntentExpireJob,
    WorkerRunnerService,
  ],
})
export class WorkerModule {}
