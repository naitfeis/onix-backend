import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockPaymentIntentForUpdate, lockProductForUpdate } from '../../database/money-locks';
import { withSerializableTransaction } from '../../database/transaction-retry';
import { releaseProductStock } from '../../economy/wallet/product-stock';
import { parsePaymentCheckoutMetadata } from '../../payments-checkout.types';
import { PrismaService } from '../../prisma.service';

/**
 * Mark stale PENDING/CREATED payment intents as EXPIRED and release checkout stock holds.
 * Default TTL 30m for faster soft-reserve release (override via PAYMENT_INTENT_TTL_MS).
 */
@Injectable()
export class PaymentIntentExpireJob {
  constructor(private readonly prisma: PrismaService) {}

  async run(batchSize = 100): Promise<number> {
    const maxAgeMs = Number(process.env.PAYMENT_INTENT_TTL_MS ?? 30 * 60 * 1000);
    const cutoff = new Date(Date.now() - (Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : 30 * 60 * 1000));
    const stale = await this.prisma.paymentIntent.findMany({
      where: {
        status: { in: ['CREATED', 'PENDING'] },
        createdAt: { lte: cutoff },
      },
      select: { id: true },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    });
    let expired = 0;
    for (const row of stale) {
      const ok = await withSerializableTransaction(this.prisma, async (tx) => {
        await lockPaymentIntentForUpdate(tx, row.id);
        const intent = await tx.paymentIntent.findUnique({ where: { id: row.id } });
        if (!intent || (intent.status !== 'CREATED' && intent.status !== 'PENDING')) {
          return false;
        }
        const checkout = parsePaymentCheckoutMetadata(intent.metadata);
        if (checkout?.stockReserved) {
          await lockProductForUpdate(tx, checkout.productId);
          await releaseProductStock(tx, checkout.productId, checkout.quantity);
          if (intent.metadata && typeof intent.metadata === 'object') {
            const next = {
              ...(intent.metadata as Record<string, unknown>),
              checkout: {
                ...((intent.metadata as { checkout?: Record<string, unknown> }).checkout ?? {}),
                stockReserved: false,
              },
            };
            await tx.paymentIntent.update({
              where: { id: intent.id },
              data: {
                status: 'EXPIRED',
                metadata: next as Prisma.InputJsonValue,
              },
            });
            return true;
          }
        }
        await tx.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'EXPIRED' },
        });
        return true;
      });
      if (ok) expired += 1;
    }
    return expired;
  }
}
