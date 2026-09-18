import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../observability/metrics.service';
import { AlertingService } from '../../observability/alerting.service';
import { structuredLog } from '../../observability/structured-logger';

/** Days in DISPUTE with no admin resolve before SLA breach alert (standard-value orders). */
const DISPUTE_SLA_DAYS = Number(process.env.DISPUTE_SLA_DAYS ?? '7');
/** Tighter SLA (days) for orders at/above DISPUTE_SLA_HIGH_VALUE_CENTS — more money, more risk. */
const DISPUTE_SLA_HIGH_VALUE_DAYS = Number(process.env.DISPUTE_SLA_HIGH_VALUE_DAYS ?? '2');
/** Threshold (cents) at which the tighter high-value SLA applies. Default 10 000 ₽. */
const DISPUTE_SLA_HIGH_VALUE_CENTS = BigInt(process.env.DISPUTE_SLA_HIGH_VALUE_CENTS ?? '1000000');

function standardSlaDays(): number {
  return Number.isFinite(DISPUTE_SLA_DAYS) && DISPUTE_SLA_DAYS > 0 ? DISPUTE_SLA_DAYS : 7;
}

function highValueSlaDays(): number {
  return Number.isFinite(DISPUTE_SLA_HIGH_VALUE_DAYS) && DISPUTE_SLA_HIGH_VALUE_DAYS > 0
    ? DISPUTE_SLA_HIGH_VALUE_DAYS
    : 2;
}

/** Per-order SLA in days — high-value disputes get paged sooner than the flat default. */
function slaDaysFor(totalAmountCents: bigint): number {
  return totalAmountCents >= DISPUTE_SLA_HIGH_VALUE_CENTS ? highValueSlaDays() : standardSlaDays();
}

/**
 * Stale DISPUTE watcher — reputation gate for small teams.
 * Does NOT auto-refund (policy must be human). Escalates: metrics, webhook, SecurityEvent,
 * bumps open ORDER_DISPUTE tickets to CRITICAL. Tiered SLA: high-value orders page sooner
 * than the flat default so a single reviewer triages by risk, not just by arrival order.
 */
@Injectable()
export class DisputeSlaJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertingService,
  ) {}

  async run(): Promise<number> {
    // Widest possible window up front (standard SLA); per-order filtering below applies
    // the tighter high-value threshold so we don't miss orders that are stale only
    // under the shorter SLA but still within the standard cutoff.
    const wideCutoff = new Date(Date.now() - standardSlaDays() * 86_400_000);

    const candidates = await this.prisma.order.findMany({
      where: {
        status: 'DISPUTE',
        updatedAt: { lte: wideCutoff },
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

    // Also catch high-value orders that breach the tighter SLA but not the wide one yet.
    const extraCutoff = new Date(Date.now() - highValueSlaDays() * 86_400_000);
    const extraHighValue = standardSlaDays() > highValueSlaDays()
      ? await this.prisma.order.findMany({
        where: {
          status: 'DISPUTE',
          updatedAt: { lte: extraCutoff, gt: wideCutoff },
          totalAmountCents: { gte: DISPUTE_SLA_HIGH_VALUE_CENTS },
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
      })
      : [];

    const stale = [...extraHighValue, ...candidates].filter((order) =>
      order.updatedAt.getTime() <= Date.now() - slaDaysFor(order.totalAmountCents) * 86_400_000,
    );

    this.metrics.gauge('onix_dispute_stale_count', stale.length);
    if (stale.length === 0) return 0;

    let alerted = 0;
    for (const order of stale) {
      const days = slaDaysFor(order.totalAmountCents);
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
        description: `Stale DISPUTE orders past SLA (standard ${standardSlaDays()}d / high-value ${highValueSlaDays()}d)`,
        detail: {
          count: alerted,
          standardSlaDays: standardSlaDays(),
          highValueSlaDays: highValueSlaDays(),
          highValueThresholdCents: DISPUTE_SLA_HIGH_VALUE_CENTS.toString(),
          sampleOrders: stale.slice(0, 5).map((o) => ({
            orderId: o.id.toString(),
            slaDays: slaDaysFor(o.totalAmountCents),
            amountRub: (Number(o.totalAmountCents) / 100).toFixed(2),
          })),
        },
      });
    }

    return alerted;
  }
}
