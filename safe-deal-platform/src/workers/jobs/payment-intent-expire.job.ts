import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * Mark stale PENDING/CREATED payment intents as EXPIRED (no money movement).
 */
@Injectable()
export class PaymentIntentExpireJob {
  constructor(private readonly prisma: PrismaService) {}

  async run(batchSize = 100): Promise<number> {
    const maxAgeMs = Number(process.env.PAYMENT_INTENT_TTL_MS ?? 48 * 60 * 60 * 1000);
    const cutoff = new Date(Date.now() - (Number.isFinite(maxAgeMs) ? maxAgeMs : 48 * 60 * 60 * 1000));
    const stale = await this.prisma.paymentIntent.findMany({
      where: {
        status: { in: ['CREATED', 'PENDING'] },
        createdAt: { lte: cutoff },
      },
      select: { id: true },
      take: batchSize,
    });
    if (!stale.length) return 0;
    const result = await this.prisma.paymentIntent.updateMany({
      where: { id: { in: stale.map((s) => s.id) }, status: { in: ['CREATED', 'PENDING'] } },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }
}
