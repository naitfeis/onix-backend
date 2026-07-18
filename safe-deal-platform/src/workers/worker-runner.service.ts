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

type JobDef = {
  name: string;
  intervalMs: number;
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
    private readonly depositUnlock: DepositUnlockJob,
    private readonly trustRecompute: TrustRecomputeJob,
    private readonly idempotencyCleanup: IdempotencyCleanupJob,
    private readonly paymentExpire: PaymentIntentExpireJob,
  ) {}

  onModuleInit(): void {
    const jobs: JobDef[] = [
      {
        name: 'deposit-unlock',
        intervalMs: Number(process.env.WORKER_DEPOSIT_UNLOCK_MS ?? 60_000),
        run: () => this.depositUnlock.run(),
      },
      {
        name: 'trust-recompute',
        intervalMs: Number(process.env.WORKER_TRUST_RECOMPUTE_MS ?? 120_000),
        run: () => this.trustRecompute.run(),
      },
      {
        name: 'idempotency-cleanup',
        intervalMs: Number(process.env.WORKER_IDEMPOTENCY_CLEANUP_MS ?? 300_000),
        run: () => this.idempotencyCleanup.run(),
      },
      {
        name: 'payment-intent-expire',
        intervalMs: Number(process.env.WORKER_PAYMENT_EXPIRE_MS ?? 600_000),
        run: () => this.paymentExpire.run(),
      },
    ];

    for (const job of jobs) {
      const interval = Number.isFinite(job.intervalMs) && job.intervalMs >= 5_000 ? job.intervalMs : 60_000;
      // Stagger first run so cold start does not stampede DB.
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
    });
    try {
      const processed = await job.run();
      const durationMs = Date.now() - started;
      await this.prisma.workerJobRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          ok: true,
          processed,
          metadata: { durationMs } as Prisma.InputJsonValue,
        },
      });
      this.metrics.recordWorkerJob(job.name, processed, true, durationMs);
      if (processed > 0) {
        structuredLog.info('worker job ok', { job: job.name, processed, durationMs });
      }
    } catch (err) {
      const durationMs = Date.now() - started;
      const message = err instanceof Error ? err.message.slice(0, 1000) : 'error';
      await this.prisma.workerJobRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          ok: false,
          error: message,
          metadata: { durationMs } as Prisma.InputJsonValue,
        },
      }).catch(() => undefined);
      this.metrics.recordWorkerJob(job.name, 0, false, durationMs);
      this.errors.capture(err, { tags: { job: job.name }, route: `worker:${job.name}` });
    }
  }
}
