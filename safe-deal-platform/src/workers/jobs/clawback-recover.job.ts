import { Injectable } from '@nestjs/common';
import { ClawbackService } from '../../economy/wallet/clawback.service';
import { lockUsersInIdOrder } from '../../database/money-locks';
import { withSerializableTransaction } from '../../database/transaction-retry';
import { PrismaService } from '../../prisma.service';

/** Recover OPEN/PARTIAL OrderClawback from seller available balance. */
@Injectable()
export class ClawbackRecoverJob {
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
    for (const row of due) {
      const { recoveredNow } = await withSerializableTransaction(this.prisma, async (tx) => {
        await lockUsersInIdOrder(tx, [row.sellerId]);
        return this.clawbacks.recoverOpen(tx, row.id);
      });
      if (recoveredNow > 0n) processed += 1;
    }
    return processed;
  }
}
