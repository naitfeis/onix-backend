import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../observability/metrics.service';
import { structuredLog } from '../../observability/structured-logger';

/**
 * Spot-check monetary integrity (balances vs ledger, deposit totals, escrow locks).
 * Any mismatch increments onix_reconciliation_mismatches and fires CRITICAL alerts.
 */
@Injectable()
export class LedgerReconciliationJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async run(sampleSize = 200): Promise<number> {
    const limit = Math.min(Math.max(sampleSize, 10), 1_000);
    let mismatches = 0;

    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        balanceCents: true,
        depositAvailableCents: true,
        depositLockedCents: true,
      },
      orderBy: { id: 'desc' },
      take: limit,
    });

    for (const user of users) {
      const ledgerSum = await this.prisma.ledgerEntry.aggregate({
        where: { userId: user.id },
        _sum: { amountCents: true },
      });
      // Opening balance is not stored — reconstruct via: current - sum(ledger) should equal
      // the implied opening. Instead verify last ledger balanceAfter == current when rows exist.
      const last = await this.prisma.ledgerEntry.findFirst({
        where: { userId: user.id },
        orderBy: { id: 'desc' },
        select: { balanceAfterCents: true },
      });
      if (last && last.balanceAfterCents !== user.balanceCents) {
        mismatches += 1;
        structuredLog.error('reconciliation balance mismatch', {
          userId: user.id.toString(),
          balanceCents: user.balanceCents.toString(),
          lastBalanceAfter: last.balanceAfterCents.toString(),
        });
        continue;
      }

      if (user.depositAvailableCents < 0n || user.depositLockedCents < 0n) {
        mismatches += 1;
        structuredLog.error('reconciliation negative deposit', {
          userId: user.id.toString(),
        });
        continue;
      }

      const activeLocks = await this.prisma.depositLock.aggregate({
        where: { userId: user.id, status: 'ACTIVE' },
        _sum: { amountCents: true },
      });
      const lockedFromLocks = activeLocks._sum.amountCents ?? 0n;
      if (lockedFromLocks !== user.depositLockedCents) {
        mismatches += 1;
        structuredLog.error('reconciliation deposit lock mismatch', {
          userId: user.id.toString(),
          depositLockedCents: user.depositLockedCents.toString(),
          activeLocksSum: lockedFromLocks.toString(),
        });
      }

      void ledgerSum;
    }

    // Escrow: COMPLETED orders must have SALE_PAYOUT (or zero payout) and no double payout.
    const completed = await this.prisma.order.findMany({
      where: { status: 'COMPLETED', payoutCents: { gt: 0 } },
      select: { id: true, payoutCents: true },
      orderBy: { completedAt: 'desc' },
      take: Math.min(limit, 100),
    });
    for (const order of completed) {
      const payouts = await this.prisma.ledgerEntry.count({
        where: { orderId: order.id, type: 'SALE_PAYOUT' },
      });
      if (payouts !== 1) {
        mismatches += 1;
        structuredLog.error('reconciliation payout count mismatch', {
          dealId: order.id.toString(),
          payoutRows: payouts,
        });
      }
    }

    this.metrics.gauge('onix_reconciliation_mismatches', mismatches);
    if (mismatches > 0) {
      this.metrics.inc('onix_reconciliation_mismatch_events_total', {}, mismatches);
    }
    return mismatches;
  }
}
