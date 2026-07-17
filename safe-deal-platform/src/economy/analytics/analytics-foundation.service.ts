import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { createId } from '../wallet/cuid';

export type RecordViewInput = {
  productId: string;
  viewerUserId?: bigint | null;
  fingerprintHash?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  /** Client hint: prefetch / bot — ignored for counting. */
  purpose?: string | null;
  isPrefetch?: boolean;
};

const BOT_UA = /bot|spider|crawl|slurp|facebookexternalhit|preview|headless/i;

/**
 * Analytics foundation: unique views only. Stage 2 UI reads rollups;
 * this service enforces anti-fraud rules at write time.
 */
@Injectable()
export class AnalyticsFoundationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns whether a new unique view was recorded.
   * Does not count: owner, bots, prefetch, missing identity.
   */
  async recordUniqueProductView(input: RecordViewInput): Promise<{ counted: boolean; reason?: string }> {
    if (input.isPrefetch || input.purpose === 'prefetch') {
      return { counted: false, reason: 'prefetch' };
    }
    if (input.userAgent && BOT_UA.test(input.userAgent)) {
      return { counted: false, reason: 'bot' };
    }

    const product = await this.prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true, sellerId: true },
    });
    if (!product) return { counted: false, reason: 'not_found' };
    if (input.viewerUserId && input.viewerUserId === product.sellerId) {
      return { counted: false, reason: 'owner' };
    }

    const viewerKey = this.viewerKey(input);
    if (!viewerKey) return { counted: false, reason: 'no_viewer_key' };

    try {
      await this.prisma.productViewUnique.create({
        data: {
          id: createId(),
          productId: product.id,
          sellerId: product.sellerId,
          viewerKey,
          viewerUserId: input.viewerUserId ?? null,
        },
      });
      return { counted: true };
    } catch {
      // Unique violation — already viewed
      await this.prisma.productViewUnique.updateMany({
        where: { productId: product.id, viewerKey },
        data: { lastSeenAt: new Date() },
      });
      return { counted: false, reason: 'duplicate' };
    }
  }

  private viewerKey(input: RecordViewInput): string | null {
    if (input.viewerUserId) return `u:${input.viewerUserId.toString()}`;
    if (input.fingerprintHash) return `f:${input.fingerprintHash.slice(0, 64)}`;
    if (input.ipHash && input.userAgent) {
      const h = createHash('sha256')
        .update(`${input.ipHash}|${input.userAgent}`)
        .digest('hex')
        .slice(0, 32);
      return `a:${h}`;
    }
    return null;
  }
}
