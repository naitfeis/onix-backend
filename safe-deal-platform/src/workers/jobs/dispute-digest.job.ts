import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../observability/metrics.service';
import { AlertingService } from '../../observability/alerting.service';
import { structuredLog } from '../../observability/structured-logger';

const JOB_NAME = 'dispute-digest';

/** UTC hour the daily digest should fire (default: 07:00 UTC ≈ 10:00 Moscow). */
function digestHourUtc(): number {
  const n = Number(process.env.DISPUTE_DIGEST_HOUR_UTC ?? '7');
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : 7;
}

/**
 * Once-a-day summary of the open-dispute queue, so one person handling
 * support does not have to remember to log into the admin panel to see
 * whether the backlog is growing. Reuses the generic WorkerJobRun history
 * as the "did we already send today" marker — no new schema needed.
 *
 * This never resolves anything automatically (same policy as DisputeSlaJob):
 * it only reports so a human can prioritise.
 */
@Injectable()
export class DisputeDigestJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertingService,
  ) {}

  async run(): Promise<number> {
    const now = new Date();
    if (now.getUTCHours() !== digestHourUtc()) return 0;

    const lastSent = await this.prisma.workerJobRun.findFirst({
      where: { jobName: JOB_NAME, ok: true, processed: { gt: 0 } },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    });
    if (lastSent?.finishedAt && isSameUtcDay(lastSent.finishedAt, now)) {
      return 0; // already sent today
    }

    const [openDisputes, openAppeals] = await Promise.all([
      this.prisma.order.findMany({
        where: { status: 'DISPUTE' },
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: { id: true, createdAt: true, totalAmountCents: true },
      }),
      this.prisma.supportTicket.count({
        where: {
          category: { in: ['BAN_APPEAL', 'SELL_BAN_APPEAL'] },
          status: { in: ['OPEN', 'IN_REVIEW'] },
        },
      }),
    ]);

    const count = openDisputes.length;
    const totalCents = openDisputes.reduce((sum, o) => sum + o.totalAmountCents, 0n);
    const oldest = openDisputes[0];
    const oldestAgeDays = oldest
      ? Math.floor((now.getTime() - oldest.createdAt.getTime()) / 86_400_000)
      : 0;
    const top5 = openDisputes.slice(0, 5).map((o) => ({
      orderId: o.id.toString(),
      ageDays: Math.floor((now.getTime() - o.createdAt.getTime()) / 86_400_000),
      amountRub: (Number(o.totalAmountCents) / 100).toFixed(2),
    }));

    this.metrics.gauge('onix_dispute_digest_open_count', count);
    structuredLog.info('dispute daily digest', {
      count,
      openAppeals,
      totalRub: (Number(totalCents) / 100).toFixed(2),
      oldestAgeDays,
    });

    await this.alerts.page({
      id: 'dispute-daily-digest',
      severity: 'warning',
      description: count > 0
        ? `Ежедневный дайджест: открытых споров ${count}, апелляций на блокировку ${openAppeals}, старейший ${oldestAgeDays}д`
        : `Ежедневный дайджест: открытых споров нет, апелляций на блокировку ${openAppeals}`,
      detail: {
        openDisputeCount: count,
        openAppealCount: openAppeals,
        totalOpenAmountRub: (Number(totalCents) / 100).toFixed(2),
        oldestAgeDays,
        top5OldestDisputes: top5,
      },
    });

    // processed > 0 marks "sent today" for the same-day guard above, even when the
    // queue itself is empty — an explicit "0 open" digest is still a sent digest.
    return 1;
  }
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}
