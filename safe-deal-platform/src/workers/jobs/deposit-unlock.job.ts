import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { LockService } from '../../economy/wallet/lock.service';

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

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
      await this.prisma.$transaction(async (tx) => {
        await this.locks.releaseLock(tx, row.id);
      }, SERIALIZABLE);
      processed += 1;
    }
    return processed;
  }
}
