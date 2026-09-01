import { Injectable } from '@nestjs/common';
import { lockUsersInIdOrder } from '../../database/money-locks';
import { withSerializableTransaction } from '../../database/transaction-retry';
import { PrismaService } from '../../prisma.service';
import { LockService } from '../../economy/wallet/lock.service';

/**
 * Global sweep for expired ACTIVE deposit locks.
 * Complements lazy per-user unlock on wallet access.
 */
@Injectable()
export class DepositUnlockJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockService,
  ) {}

  async run(batchSize = 50): Promise<number> {
    const due = await this.prisma.depositLock.findMany({
      where: { status: 'ACTIVE', unlockAt: { lte: new Date() } },
      select: { id: true, userId: true },
      take: batchSize,
      orderBy: { unlockAt: 'asc' },
    });
    let processed = 0;
    for (const row of due) {
      await withSerializableTransaction(this.prisma, async (tx) => {
        await lockUsersInIdOrder(tx, [row.userId]);
        await this.locks.releaseLock(tx, row.id);
      });
      processed += 1;
    }
    return processed;
  }
}
