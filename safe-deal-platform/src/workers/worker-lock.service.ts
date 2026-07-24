import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { structuredLog } from '../observability/structured-logger';

/**
 * Pool-safe job lease — advisory-lock equivalent under Prisma connection pooling
 * (session pg_advisory_lock is unsafe across pooled connections).
 */
@Injectable()
export class WorkerLockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Try to run `fn` under an exclusive lease. Returns 0 when another holder owns the lease.
   */
  async withLease(jobName: string, ttlMs: number, fn: () => Promise<number>): Promise<number> {
    const holderId = `${process.pid}:${randomUUID().slice(0, 8)}`;
    const acquired = await this.tryAcquire(jobName, holderId, ttlMs);
    if (!acquired) {
      structuredLog.info('worker job skipped — lease held', { job: jobName });
      return 0;
    }
    try {
      return await fn();
    } finally {
      await this.release(jobName, holderId);
    }
  }

  private async tryAcquire(jobName: string, holderId: string, ttlMs: number): Promise<boolean> {
    const lockedUntil = new Date(Date.now() + Math.max(5_000, ttlMs));
    // Insert or steal expired / same-holder lease. Affected row count = success.
    const affected = await this.prisma.$executeRaw`
      INSERT INTO "WorkerJobLease" ("jobName", "holderId", "lockedUntil", "updatedAt")
      VALUES (${jobName}, ${holderId}, ${lockedUntil}, NOW())
      ON CONFLICT ("jobName") DO UPDATE
        SET "holderId" = EXCLUDED."holderId",
            "lockedUntil" = EXCLUDED."lockedUntil",
            "updatedAt" = NOW()
      WHERE "WorkerJobLease"."lockedUntil" < NOW()
         OR "WorkerJobLease"."holderId" = EXCLUDED."holderId"
    `;
    return Number(affected) > 0;
  }

  private async release(jobName: string, holderId: string): Promise<void> {
    await this.prisma.workerJobLease.deleteMany({
      where: { jobName, holderId },
    }).catch(() => undefined);
  }
}
