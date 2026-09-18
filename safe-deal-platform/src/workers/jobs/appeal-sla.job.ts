import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../observability/metrics.service';
import { AlertingService } from '../../observability/alerting.service';
import { structuredLog } from '../../observability/structured-logger';
import { appealSlaHours } from '../../support-sla.config';

/**
 * Stale BAN_APPEAL / SELL_BAN_APPEAL watcher.
 *
 * Only OPEN / IN_REVIEW count against the clock — WAITING_USER means we already
 * responded and are waiting on the user, so it must not page us again.
 */
@Injectable()
export class AppealSlaJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertingService,
  ) {}

  async run(): Promise<number> {
    const hours = appealSlaHours();
    const cutoff = new Date(Date.now() - hours * 3_600_000);

    const stale = await this.prisma.supportTicket.findMany({
      where: {
        category: { in: ['BAN_APPEAL', 'SELL_BAN_APPEAL'] },
        status: { in: ['OPEN', 'IN_REVIEW'] },
        updatedAt: { lte: cutoff },
      },
      select: {
        id: true,
        publicNumber: true,
        category: true,
        priority: true,
        openedById: true,
        reportedUserId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });

    this.metrics.gauge('onix_appeal_stale_count', stale.length);
    if (stale.length === 0) return 0;

    let alerted = 0;
    for (const ticket of stale) {
      const userId = ticket.reportedUserId ?? ticket.openedById;
      const ageHours = Math.floor((Date.now() - ticket.updatedAt.getTime()) / 3_600_000);
      const dedupeKey = `appeal-sla:${ticket.id}`;

      // One SecurityEvent per ticket per 12h window (avoid re-paging on every job tick).
      const since = new Date(Date.now() - 12 * 3_600_000);
      const existing = await this.prisma.securityEvent.findFirst({
        where: {
          type: 'APPEAL_SLA_BREACH',
          createdAt: { gte: since },
          payload: { path: ['ticketId'], equals: ticket.id },
        },
        select: { id: true },
      });
      if (existing) continue;

      await this.prisma.securityEvent.create({
        data: {
          type: 'APPEAL_SLA_BREACH',
          status: 'OPEN',
          severity: 90,
          userId: userId ?? undefined,
          payload: {
            ticketId: ticket.id,
            publicNumber: ticket.publicNumber,
            category: ticket.category,
            ageHours,
            slaHours: hours,
            dedupeKey,
          },
        },
      });

      if (ticket.priority !== 'CRITICAL') {
        await this.prisma.supportTicket.update({
          where: { id: ticket.id },
          data: { priority: 'CRITICAL' },
        });
      }

      structuredLog.error('appeal SLA breach', {
        ticketId: ticket.id,
        ageHours,
        slaHours: hours,
      });
      this.metrics.inc('onix_appeal_sla_breach_events_total');
      alerted += 1;
    }

    if (alerted > 0) {
      this.metrics.inc('onix_appeal_sla_breach_events_total', {}, 0); // ensure series exists
      await this.alerts.page({
        id: 'appeal-sla-stale',
        severity: 'critical',
        description: `Ban/sell-ban appeals past ${hours}h SLA — possible wrongful lock left unresolved`,
        detail: { count: alerted, slaHours: hours, sampleTicketIds: stale.slice(0, 5).map((t) => t.id) },
      });
    }

    return alerted;
  }
}
