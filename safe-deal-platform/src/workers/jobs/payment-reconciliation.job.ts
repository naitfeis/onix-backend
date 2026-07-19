import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MetricsService } from '../../observability/metrics.service';
import { structuredLog } from '../../observability/structured-logger';

export type PaymentReconciliationReport = {
  orphanSucceededWithoutLedger: number;
  pendingWithProviderRefStale: number;
  duplicatePaymentCredits: number;
  /** Gaps found — alert only; never auto-credit. */
  criticalGaps: number;
};

/**
 * Provider ↔ PaymentIntent ↔ Ledger reconciliation.
 *
 * CRITICAL when:
 * - intent SUCCEEDED but no ledger credit for payment:{id}:*
 * - intent still PENDING but providerRef set for longer than stale window
 *   (provider may have charged; local money-path not finished)
 *
 * Never auto-credits. Ops must investigate and apply via safe money-path.
 */
@Injectable()
export class PaymentReconciliationJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async run(limit = 200): Promise<number> {
    const report = await this.audit(limit);
    this.metrics.gauge('onix_payment_reconciliation_gaps', report.criticalGaps);
    if (report.criticalGaps > 0) {
      this.metrics.inc('onix_payment_reconciliation_gap_events_total', {}, report.criticalGaps);
      structuredLog.error('payment reconciliation CRITICAL gaps', {
        ...report,
        autoCredit: false,
      });
    }
    return report.criticalGaps;
  }

  async audit(limit = 200): Promise<PaymentReconciliationReport> {
    const take = Math.min(Math.max(limit, 10), 1_000);
    let orphanSucceededWithoutLedger = 0;
    let pendingWithProviderRefStale = 0;
    let duplicatePaymentCredits = 0;

    const succeeded = await this.prisma.paymentIntent.findMany({
      where: { status: 'SUCCEEDED' },
      select: { id: true, wallet: true, amountCents: true, userId: true, providerRef: true },
      orderBy: { succeededAt: 'desc' },
      take,
    });

    for (const intent of succeeded) {
      const mainKey = `payment:${intent.id}:main`;
      const depositKey = `payment:${intent.id}:deposit`;
      if (intent.wallet === 'MAIN') {
        const rows = await this.prisma.ledgerEntry.count({
          where: { idempotencyKey: mainKey, type: 'DEPOSIT' },
        });
        if (rows === 0) {
          orphanSucceededWithoutLedger += 1;
          structuredLog.error('payment succeeded without ledger credit', {
            paymentId: intent.id,
            wallet: intent.wallet,
            providerRef: intent.providerRef ?? undefined,
          });
        } else if (rows > 1) {
          duplicatePaymentCredits += 1;
        }
      } else {
        const rows = await this.prisma.depositLedgerEntry.count({
          where: { idempotencyKey: depositKey, type: 'TOPUP' },
        });
        if (rows === 0) {
          orphanSucceededWithoutLedger += 1;
          structuredLog.error('payment succeeded without deposit ledger credit', {
            paymentId: intent.id,
            wallet: intent.wallet,
            providerRef: intent.providerRef ?? undefined,
          });
        } else if (rows > 1) {
          duplicatePaymentCredits += 1;
        }
      }
    }

    const staleMs = Number(process.env.PAYMENT_RECONCILE_STALE_MS ?? 15 * 60_000);
    const staleBefore = new Date(Date.now() - (Number.isFinite(staleMs) ? staleMs : 15 * 60_000));
    const stalePending = await this.prisma.paymentIntent.findMany({
      where: {
        status: { in: ['CREATED', 'PENDING'] },
        providerRef: { not: null },
        updatedAt: { lt: staleBefore },
      },
      select: { id: true, provider: true, providerRef: true, updatedAt: true },
      take,
    });
    for (const intent of stalePending) {
      pendingWithProviderRefStale += 1;
      structuredLog.error('provider-linked payment still pending locally', {
        paymentId: intent.id,
        provider: intent.provider,
        providerRef: intent.providerRef ?? undefined,
        updatedAt: intent.updatedAt.toISOString(),
        action: 'CRITICAL_ALERT_NO_AUTO_CREDIT',
      });
    }

    const criticalGaps =
      orphanSucceededWithoutLedger + pendingWithProviderRefStale + duplicatePaymentCredits;
    return {
      orphanSucceededWithoutLedger,
      pendingWithProviderRefStale,
      duplicatePaymentCredits,
      criticalGaps,
    };
  }
}
