import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../observability/metrics.service';
import { structuredLog } from '../../observability/structured-logger';

/** Alert when open clawback debt is large or stale (platform float risk). */
const CLAWBACK_ALERT_MIN_CENTS = BigInt(process.env.CLAWBACK_ALERT_MIN_CENTS ?? '50000'); // 500 ₽
const CLAWBACK_ALERT_AGE_MS = Number(process.env.CLAWBACK_ALERT_AGE_HOURS ?? '24') * 3_600_000;

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

      // Reconstruct opening from first ledger row: opening + Σ(amounts) == balance.
      const first = await this.prisma.ledgerEntry.findFirst({
        where: { userId: user.id },
        orderBy: { id: 'asc' },
        select: { amountCents: true, balanceAfterCents: true },
      });
      if (first) {
        const opening = first.balanceAfterCents - first.amountCents;
        const sum = ledgerSum._sum.amountCents ?? 0n;
        if (opening + sum !== user.balanceCents) {
          mismatches += 1;
          structuredLog.error('reconciliation ledger sum mismatch', {
            userId: user.id.toString(),
            balanceCents: user.balanceCents.toString(),
            openingCents: opening.toString(),
            ledgerSumCents: sum.toString(),
          });
          continue;
        }
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

    // Platform float: OPEN/PARTIAL clawbacks that are large or stale.
    const openClawbacks = await this.prisma.orderClawback.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL'] } },
      select: {
        id: true,
        orderId: true,
        sellerId: true,
        amountCents: true,
        recoveredCents: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 200,
      orderBy: { updatedAt: 'asc' },
    });
    const now = Date.now();
    let openDebtCents = 0n;
    let alerted = 0;
    for (const row of openClawbacks) {
      const remaining = row.amountCents - row.recoveredCents;
      if (remaining <= 0n) continue;
      openDebtCents += remaining;
      const ageMs = now - row.createdAt.getTime();
      if (remaining >= CLAWBACK_ALERT_MIN_CENTS || ageMs >= CLAWBACK_ALERT_AGE_MS) {
        alerted += 1;
        structuredLog.error('open clawback alert', {
          clawbackId: row.id,
          dealId: row.orderId.toString(),
          sellerId: row.sellerId.toString(),
          remainingCents: remaining.toString(),
          ageHours: Math.floor(ageMs / 3_600_000),
        });
      }
    }
    this.metrics.gauge('onix_clawback_open_debt_cents', Number(openDebtCents > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : openDebtCents));
    this.metrics.gauge('onix_clawback_open_alerts', alerted);

    this.metrics.gauge('onix_reconciliation_mismatches', mismatches);
    if (mismatches > 0) {
      this.metrics.inc('onix_reconciliation_mismatch_events_total', {}, mismatches);
    }
    return mismatches;
  }
}
