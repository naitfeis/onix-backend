import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MetricsService } from '../observability/metrics.service';
import { ErrorTrackingService } from '../observability/error-tracking.service';
import { structuredLog } from '../observability/structured-logger';
import { DepositUnlockJob } from './jobs/deposit-unlock.job';
import { TrustRecomputeJob } from './jobs/trust-recompute.job';
import { IdempotencyCleanupJob } from './jobs/idempotency-cleanup.job';
import { PaymentIntentExpireJob } from './jobs/payment-intent-expire.job';
import { LedgerReconciliationJob } from './jobs/ledger-reconciliation.job';
import { PaymentReconciliationJob } from './jobs/payment-reconciliation.job';
import { ClawbackRecoverJob } from './jobs/clawback-recover.job';
import { SecurityIpRetentionJob } from './jobs/security-ip-retention.job';
import { ShadowListingJob } from './jobs/shadow-listing.job';
import { WorkerLockService } from './worker-lock.service';

type JobDef = {
  name: string;
  intervalMs: number;
  /** Lease TTL — must exceed worst-case job runtime. */
  leaseTtlMs: number;
  run: () => Promise<number>;
};

@Injectable()
export class WorkerRunnerService implements OnModuleInit, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly errors: ErrorTrackingService,
    private readonly locks: WorkerLockService,
    private readonly depositUnlock: DepositUnlockJob,
    private readonly trustRecompute: TrustRecomputeJob,
    private readonly idempotencyCleanup: IdempotencyCleanupJob,
    private readonly paymentExpire: PaymentIntentExpireJob,
    private readonly ledgerReconciliation: LedgerReconciliationJob,
    private readonly paymentReconciliation: PaymentReconciliationJob,
    private readonly clawbackRecover: ClawbackRecoverJob,
    private readonly securityIpRetention: SecurityIpRetentionJob,
    private readonly shadowListing: ShadowListingJob,
  ) {}

  onModuleInit(): void {
    const jobs: JobDef[] = [
      {
        name: 'deposit-unlock',
        intervalMs: Number(process.env.WORKER_DEPOSIT_UNLOCK_MS ?? 60_000),
        leaseTtlMs: 120_000,
        run: () => this.depositUnlock.run(),
      },
      {
        name: 'trust-recompute',
        intervalMs: Number(process.env.WORKER_TRUST_RECOMPUTE_MS ?? 120_000),
        leaseTtlMs: 180_000,
        run: () => this.trustRecompute.run(),
      },
      {
        name: 'idempotency-cleanup',
        intervalMs: Number(process.env.WORKER_IDEMPOTENCY_CLEANUP_MS ?? 300_000),
        leaseTtlMs: 300_000,
        run: () => this.idempotencyCleanup.run(),
      },
      {
        name: 'payment-intent-expire',
        intervalMs: Number(process.env.WORKER_PAYMENT_EXPIRE_MS ?? 600_000),
        leaseTtlMs: 300_000,
        run: () => this.paymentExpire.run(),
      },
      {
        name: 'ledger-reconciliation',
        intervalMs: Number(process.env.WORKER_LEDGER_RECONCILE_MS ?? 900_000),
        leaseTtlMs: 600_000,
        run: () => this.ledgerReconciliation.run(),
      },
      {
        name: 'payment-reconciliation',
        intervalMs: Number(process.env.WORKER_PAYMENT_RECONCILE_MS ?? 300_000),
        leaseTtlMs: 300_000,
        run: () => this.paymentReconciliation.run(),
      },
      {
        name: 'clawback-recover',
        intervalMs: Number(process.env.WORKER_CLAWBACK_RECOVER_MS ?? 60_000),
        leaseTtlMs: 120_000,
        run: () => this.clawbackRecover.run(),
      },
      {
        name: 'security-ip-retention',
        intervalMs: Number(process.env.WORKER_SECURITY_IP_RETENTION_MS ?? 3_600_000),
        leaseTtlMs: 600_000,
        run: () => this.securityIpRetention.run(),
      },
      {
        name: 'shadow-listing',
        intervalMs: Number(process.env.WORKER_SHADOW_LISTING_MS ?? 300_000),
        leaseTtlMs: 180_000,
        run: () => this.shadowListing.run(),
      },
    ];

    for (const job of jobs) {
      const interval = Number.isFinite(job.intervalMs) && job.intervalMs >= 5_000 ? job.intervalMs : 60_000;
      const delay = 2_000 + Math.floor(Math.random() * 3_000);
      const starter = setTimeout(() => {
        void this.execute(job);
        const t = setInterval(() => { void this.execute(job); }, interval);
        t.unref?.();
        this.timers.push(t);
      }, delay);
      starter.unref?.();
      this.timers.push(starter);
      structuredLog.info('worker job scheduled', { job: job.name, intervalMs: interval });
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    for (const t of this.timers) clearInterval(t);
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    structuredLog.info('worker runner stopped');
  }

  private async execute(job: JobDef): Promise<void> {
    if (this.stopping) return;
    const started = Date.now();
    const run = await this.prisma.workerJobRun.create({
      data: { jobName: job.name },
      select: { id: true },
    }).catch((error) => {
      structuredLog.warn('worker job-run create failed', { job: job.name }, error);
      return null;
    });
    try {
      const processed = await this.locks.withLease(job.name, job.leaseTtlMs, () => job.run());
      const durationMs = Date.now() - started;
      if (run) {
        await this.prisma.workerJobRun.update({
          where: { id: run.id },
          data: {
            finishedAt: new Date(),
            ok: true,
            processed,
            metadata: { durationMs, leased: true } as Prisma.InputJsonValue,
          },
        }).catch((error) => {
          structuredLog.warn('worker job-run success persistence failed', { job: job.name }, error);
        });
      }
      this.metrics.recordWorkerJob(job.name, processed, true, durationMs);
      if (processed > 0) {
        structuredLog.info('worker job ok', { job: job.name, processed, durationMs });
      }
    } catch (err) {
      const durationMs = Date.now() - started;
      const message = err instanceof Error ? err.message.slice(0, 1000) : 'error';
      if (run) {
        await this.prisma.workerJobRun.update({
          where: { id: run.id },
          data: {
            finishedAt: new Date(),
            ok: false,
            error: message,
            metadata: { durationMs } as Prisma.InputJsonValue,
          },
        }).catch((error) => {
          structuredLog.warn('worker job-run failure persistence failed', { job: job.name }, error);
          try {
            process.stderr.write(`worker ${job.name} persist-fail ${String(error)}\n`);
          } catch {
            /* ignore */
          }
        });
      }
      this.metrics.recordWorkerJob(job.name, 0, false, durationMs);
      this.errors.capture(err, { tags: { job: job.name }, route: `worker:${job.name}` });
    }
  }
}
