import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TrustService } from '../../economy/trust/trust.service';

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      await worker(items[idx]!);
    }
  }));
}

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
    await mapPool(dirty, 6, async (u) => {
      await this.trust.recompute(u.id);
    });
    return dirty.length;
  }
}
