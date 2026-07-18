import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TrustService } from '../../economy/trust/trust.service';

@Injectable()
export class TrustRecomputeJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trust: TrustService,
  ) {}

  async run(batchSize = 40): Promise<number> {
    const dirty = await this.prisma.user.findMany({
      where: { deletedAt: null, trustDirty: true },
      select: { id: true },
      take: batchSize,
      orderBy: { updatedAt: 'asc' },
    });
    let processed = 0;
    for (const u of dirty) {
      await this.trust.recompute(u.id);
      processed += 1;
    }
    return processed;
  }
}
