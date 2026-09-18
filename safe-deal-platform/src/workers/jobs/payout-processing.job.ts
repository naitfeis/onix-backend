import { Inject, Injectable } from '@nestjs/common';
import { AlertingService } from '../../observability/alerting.service';
import { MetricsService } from '../../observability/metrics.service';
import { structuredLog } from '../../observability/structured-logger';
import { PrismaService } from '../../prisma.service';
import { PAYOUT_PROVIDER, type PayoutProvider } from '../../economy/payouts/payout-provider';
import { payoutsAutoEnabled } from '../../economy/payouts/payout-policy';

@Injectable()
export class PayoutProcessingJob {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertingService,
  ) {}

  async run(limit = 50): Promise<number> {
    const staleMs = Number(process.env.PAYOUT_PROCESSING_STALE_MS ?? 30 * 60_000);
    const safeStaleMs = Number.isFinite(staleMs) && staleMs >= 60_000 ? staleMs : 30 * 60_000;
    const staleBefore = new Date(Date.now() - safeStaleMs);
    const stuck = await this.prisma.payoutRequest.findMany({
      where: { status: 'PROCESSING', processingStartedAt: { lt: staleBefore } },
      select: { id: true, userId: true, amountCents: true, processingStartedAt: true },
      orderBy: { processingStartedAt: 'asc' },
      take: 100,
    });
    this.metrics.gauge('onix_payout_processing_stuck', stuck.length);
    if (stuck.length) {
      structuredLog.error('payout reconciliation found stuck PROCESSING requests', {
        count: stuck.length,
        payoutIds: stuck.map((row) => row.id).join(','),
        autoPaid: false,
      });
      await this.alerts.page({
        id: 'payout-processing-stuck',
        severity: 'critical',
        description: 'Payout requests stuck in PROCESSING; reconcile provider manually',
        detail: { count: stuck.length, payoutIds: stuck.map((row) => row.id) },
      });
    }

    // Default is deliberately inert. Approval is not evidence that a transfer occurred.
    if (!payoutsAutoEnabled()) return stuck.length;

    const approved = await this.prisma.payoutRequest.findMany({
      where: { status: 'APPROVED' },
      orderBy: { requestedAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    let handled = 0;
    for (const candidate of approved) {
      const attemptKey = `payout:${candidate.id}:${this.provider.code}:submit`;
      const claimed = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "PayoutRequest" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const current = await tx.payoutRequest.findUnique({ where: { id: candidate.id } });
        if (!current || current.status !== 'APPROVED') return null;
        const existingAttempt = await tx.payoutAttempt.findUnique({ where: { attemptKey } });
        if (existingAttempt) return null;
        const missingDestination = this.provider.externalTransferCapable && !current.destinationFingerprint;
        const attempt = await tx.payoutAttempt.create({
          data: {
            payoutRequestId: current.id,
            provider: this.provider.code,
            status: this.provider.externalTransferCapable && !missingDestination ? 'STARTED' : 'MANUAL_REVIEW',
            attemptKey,
            finishedAt: this.provider.externalTransferCapable && !missingDestination ? null : new Date(),
            errorCode: this.provider.externalTransferCapable
              ? (missingDestination ? 'MISSING_DESTINATION' : null)
              : 'NO_EXTERNAL_PROVIDER',
            errorMessage: this.provider.externalTransferCapable
              ? (missingDestination ? 'External payout requires a configured destination fingerprint.' : null)
              : 'Automatic payouts enabled without an external-transfer-capable provider.',
          },
        });
        if (!this.provider.externalTransferCapable || missingDestination) {
          await tx.payoutRequest.update({
            where: { id: current.id },
            data: {
              status: 'MANUAL_REVIEW',
              reviewReason: missingDestination
                ? 'Fail closed: external payout destination is not configured.'
                : 'Fail closed: no external-transfer-capable payout provider is configured.',
            },
          });
          return null;
        }
        await tx.payoutRequest.update({
          where: { id: current.id },
          data: { status: 'PROCESSING', processingStartedAt: new Date() },
        });
        return { payout: current, attemptId: attempt.id, attemptKey };
      });
      handled += 1;
      if (!claimed) continue;

      const result = await this.provider.submit({
        payoutRequestId: claimed.payout.id,
        attemptKey: claimed.attemptKey,
        amountCents: claimed.payout.amountCents,
        currency: claimed.payout.currency,
        destinationFingerprint: claimed.payout.destinationFingerprint,
      });
      await this.prisma.$transaction(async (tx) => {
        if (result.outcome === 'SUBMITTED') {
          await tx.payoutAttempt.update({
            where: { id: claimed.attemptId },
            data: {
              status: 'SUBMITTED',
              providerReference: result.providerReference,
              finishedAt: new Date(),
            },
          });
          // PROCESSING remains until a future authenticated provider reconciliation confirms PAID.
          return;
        }
        const manual = result.outcome === 'MANUAL_REVIEW';
        await tx.payoutAttempt.update({
          where: { id: claimed.attemptId },
          data: {
            status: manual ? 'MANUAL_REVIEW' : 'FAILED',
            errorCode: manual ? 'MANUAL_PROVIDER' : result.code,
            errorMessage: manual ? result.reason : result.message,
            finishedAt: new Date(),
          },
        });
        await tx.payoutRequest.update({
          where: { id: claimed.payout.id },
          data: {
            status: manual ? 'MANUAL_REVIEW' : 'FAILED',
            reviewReason: manual ? result.reason : result.message,
            failedAt: manual ? null : new Date(),
          },
        });
      });
    }
    return stuck.length + handled;
  }
}
