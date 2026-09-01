import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { tryDeliverNotification } from '../../domain-notify';

/**
 * Drain Notification rows with telegramPushedAt = null.
 * Complements after-commit tryDeliverNotification (crash / Telegram outage).
 */
@Injectable()
export class TelegramOutboxJob {
  constructor(private readonly prisma: PrismaService) {}

  async run(batchSize = 40): Promise<number> {
    const pending = await this.prisma.notification.findMany({
      where: { telegramPushedAt: null },
      select: { id: true },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    });
    let processed = 0;
    for (const row of pending) {
      const result = await tryDeliverNotification(this.prisma, row.id);
      if (result !== 'failed') processed += 1;
    }
    return processed;
  }
}
