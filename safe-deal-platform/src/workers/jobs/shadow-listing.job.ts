import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { SELLER_OFFLINE_SHADOW_MS } from '../../marketplace/shadow-ban';

@Injectable()
export class ShadowListingJob {
  constructor(private readonly prisma: PrismaService) {}

  async run(batchSize = 80): Promise<number> {
    const cutoff = new Date(Date.now() - SELLER_OFFLINE_SHADOW_MS);
    const staleSellers = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        lastSeenAt: { lt: cutoff },
        products: { some: { status: 'ACTIVE', shadowBannedAt: null } },
      },
      select: { id: true },
      take: batchSize,
    });
    const liveSellers = await this.prisma.user.findMany({
      where: {
        lastSeenAt: { gte: cutoff },
        products: { some: { shadowBannedAt: { not: null } } },
      },
      select: { id: true },
      take: batchSize,
    });

    let processed = 0;
    if (staleSellers.length) {
      const banned = await this.prisma.product.updateMany({
        where: {
          sellerId: { in: staleSellers.map((row) => row.id) },
          status: 'ACTIVE',
          shadowBannedAt: null,
        },
        data: { shadowBannedAt: new Date() },
      });
      processed += banned.count;
    }
    if (liveSellers.length) {
      const cleared = await this.prisma.product.updateMany({
        where: {
          sellerId: { in: liveSellers.map((row) => row.id) },
          shadowBannedAt: { not: null },
        },
        data: { shadowBannedAt: null },
      });
      processed += cleared.count;
    }
    return processed;
  }
}
