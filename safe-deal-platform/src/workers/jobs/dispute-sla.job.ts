import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../observability/metrics.service';
import { AlertingService } from '../../observability/alerting.service';
import { structuredLog } from '../../observability/structured-logger';

/** Days in DISPUTE with no admin resolve before SLA breach alert. */
const DISPUTE_SLA_DAYS = Number(process.env.DISPUTE_SLA_DAYS ?? '7');

/**
 * Stale DISPUTE watcher — reputation gate for small teams.
 * Does NOT auto-refund (policy must be human). Escalates: metrics, webhook, SecurityEvent,
 * bumps open ORDER_DISPUTE tickets to CRITICAL.
 */
@Injectable()
export class DisputeSlaJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertingService,
  ) {}

  async run(): Promise<number> {
    const days = Number.isFinite(DISPUTE_SLA_DAYS) && DISPUTE_SLA_DAYS > 0 ? DISPUTE_SLA_DAYS : 7;
    const cutoff = new Date(Date.now() - days * 86_400_000);

    const stale = await this.prisma.order.findMany({
      where: {
        status: 'DISPUTE',
        updatedAt: { lte: cutoff },
      },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        updatedAt: true,
        createdAt: true,
        totalAmountCents: true,
        supportTickets: {
          where: { status: { in: ['OPEN', 'IN_REVIEW', 'WAITING_USER'] } },
          select: { id: true, priority: true },
          take: 5,
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });

    this.metrics.gauge('onix_dispute_stale_count', stale.length);
    if (stale.length === 0) return 0;

    let alerted = 0;
    for (const order of stale) {
      const ageDays = Math.floor((Date.now() - order.updatedAt.getTime()) / 86_400_000);
      const dedupeKey = `dispute-sla:${order.id.toString()}`;

      // One SecurityEvent per order per day window (avoid spam).
      const since = new Date(Date.now() - 20 * 3_600_000);
      const existing = await this.prisma.securityEvent.findFirst({
        where: {
          type: 'DISPUTE_SLA_BREACH',
          createdAt: { gte: since },
          payload: { path: ['orderId'], equals: order.id.toString() },
        },
        select: { id: true },
      });
      if (existing) continue;

      await this.prisma.securityEvent.create({
        data: {
          type: 'DISPUTE_SLA_BREACH',
          status: 'OPEN',
          severity: 80,
          userId: order.sellerId,
          payload: {
            orderId: order.id.toString(),
            buyerId: order.buyerId.toString(),
            sellerId: order.sellerId.toString(),
            ageDays,
            totalAmountCents: order.totalAmountCents.toString(),
            slaDays: days,
            dedupeKey,
          },
        },
      });

      for (const ticket of order.supportTickets) {
        if (ticket.priority === 'CRITICAL') continue;
        await this.prisma.supportTicket.update({
          where: { id: ticket.id },
          data: { priority: 'CRITICAL' },
        });
      }

      structuredLog.error('dispute SLA breach', {
        dealId: order.id.toString(),
        ageDays,
        slaDays: days,
      });
      this.metrics.inc('onix_dispute_sla_breach_events_total');
      alerted += 1;
    }

    if (alerted > 0) {
      this.metrics.inc('onix_dispute_sla_breach_events_total', {}, 0); // ensure series exists
      await this.alerts.page({
        id: 'dispute-sla-stale',
        severity: 'critical',
        description: `Stale DISPUTE orders past ${days}d SLA`,
        detail: { count: alerted, slaDays: days, sampleOrderIds: stale.slice(0, 5).map((o) => o.id.toString()) },
      });
    }

    return alerted;
  }
}
