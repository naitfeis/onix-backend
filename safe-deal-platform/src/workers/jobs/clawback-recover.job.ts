import { Injectable, Logger } from '@nestjs/common';
import { ClawbackService } from '../../economy/wallet/clawback.service';
import { lockUsersInIdOrder } from '../../database/money-locks';
import { withSerializableTransaction } from '../../database/transaction-retry';
import { PrismaService } from '../../prisma.service';

/** Recover OPEN/PARTIAL OrderClawback from seller available balance. */
@Injectable()
export class ClawbackRecoverJob {
  private readonly logger = new Logger(ClawbackRecoverJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clawbacks: ClawbackService,
  ) {}

  async run(batchSize = 40): Promise<number> {
    const due = await this.prisma.orderClawback.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL'] } },
      select: { id: true, sellerId: true },
      take: batchSize,
      orderBy: { updatedAt: 'asc' },
    });
    let processed = 0;
    let failed = 0;
    for (const row of due) {
      /**
       * Per-row isolation. The scan is oldest-first, so a single unprocessable row used
       * to abort the whole batch and permanently block repayment for everyone else:
       * the same poisoned row would be picked up first on every run. One bad seller must
       * not stop the queue.
       */
      try {
        const { recoveredNow } = await withSerializableTransaction(this.prisma, async (tx) => {
          await lockUsersInIdOrder(tx, [row.sellerId]);
          return this.clawbacks.recoverOpen(tx, row.id);
        });
        if (recoveredNow > 0n) processed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(JSON.stringify({
          msg: 'clawback_recovery_row_failed',
          clawbackId: row.id,
          sellerId: row.sellerId.toString(),
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    if (failed > 0) {
      this.logger.warn(`clawback-recover: ${failed} of ${due.length} rows failed`);
    }
    return processed;
  }
}
