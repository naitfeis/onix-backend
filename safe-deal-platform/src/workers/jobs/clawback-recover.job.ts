import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClawbackService } from '../../economy/wallet/clawback.service';
import { PrismaService } from '../../prisma.service';

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

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
      select: { id: true },
      take: batchSize,
      orderBy: { updatedAt: 'asc' },
    });
    let processed = 0;
    for (const row of due) {
      const { recoveredNow } = await this.prisma.$transaction(
        (tx) => this.clawbacks.recoverOpen(tx, row.id),
        SERIALIZABLE,
      );
      if (recoveredNow > 0n) processed += 1;
    }
    return processed;
  }
}
