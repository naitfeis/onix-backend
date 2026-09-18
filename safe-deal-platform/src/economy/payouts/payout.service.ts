import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PayoutRequestStatus } from '@prisma/client';
import { lockUsersInIdOrder } from '../../database/money-locks';
import { withSerializableTransaction } from '../../database/transaction-retry';
import { PrismaService } from '../../prisma.service';
import type { AdminActor } from '../../admin/admin-session.service';
import { BalanceService, type Tx } from '../wallet/balance.service';
import { assessPayoutEligibility } from './payout-policy';

type CreatePayoutInput = {
  userId: bigint;
  amountCents: bigint;
  withdrawalLedgerEntryId: bigint;
  requestKey: string;
  accountCreatedAt: Date;
  securityScore: number;
  withdrawBlocked: boolean;
  securityLocked: boolean;
  suspiciousFundsHold: boolean;
};

const REJECTABLE: ReadonlySet<PayoutRequestStatus> = new Set([
  'REQUESTED', 'RISK_REVIEW', 'APPROVED', 'FAILED', 'MANUAL_REVIEW',
]);

@Injectable()
export class PayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balance: BalanceService,
  ) {}

  async createForWithdrawal(tx: Tx, input: CreatePayoutInput) {
    const existing = await tx.payoutRequest.findUnique({
      where: { withdrawalLedgerEntryId: input.withdrawalLedgerEntryId },
    });
    if (existing) return existing;

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [day, month] = await Promise.all([
      tx.payoutRequest.aggregate({
        where: { userId: input.userId, requestedAt: { gte: dayStart } },
        _sum: { amountCents: true },
      }),
      tx.payoutRequest.aggregate({
        where: { userId: input.userId, requestedAt: { gte: monthStart } },
        _sum: { amountCents: true },
      }),
    ]);
    const riskReasons = assessPayoutEligibility({
      amountCents: input.amountCents,
      dayTotalCents: day._sum.amountCents ?? 0n,
      monthTotalCents: month._sum.amountCents ?? 0n,
      accountCreatedAt: input.accountCreatedAt,
      securityScore: input.securityScore,
      withdrawBlocked: input.withdrawBlocked,
      securityLocked: input.securityLocked,
      suspiciousFundsHold: input.suspiciousFundsHold,
      now,
    });
    return tx.payoutRequest.create({
      data: {
        userId: input.userId,
        withdrawalLedgerEntryId: input.withdrawalLedgerEntryId,
        requestKey: input.requestKey,
        amountCents: input.amountCents,
        status: riskReasons.length ? 'RISK_REVIEW' : 'REQUESTED',
        provider: 'MANUAL',
        destinationFingerprint: null,
        riskReasons: riskReasons as Prisma.InputJsonValue,
      },
    });
  }

  async approve(admin: AdminActor, id: string, reason: string) {
    const note = reason.trim();
    if (!note) throw new BadRequestException('Укажите причину одобрения.');
    return withSerializableTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PayoutRequest" WHERE "id" = ${id} FOR UPDATE`;
      const payout = await tx.payoutRequest.findUnique({ where: { id } });
      if (!payout) throw new NotFoundException('Заявка на вывод не найдена.');
      if (payout.status === 'APPROVED') return this.toAdminDto(payout);
      if (!['REQUESTED', 'RISK_REVIEW', 'MANUAL_REVIEW'].includes(payout.status)) {
        throw new ConflictException(`Нельзя одобрить заявку в статусе ${payout.status}.`);
      }
      const updated = await tx.payoutRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewReason: note.slice(0, 1000),
          reviewedAt: new Date(),
          failedAt: null,
        },
      });
      await tx.adminActionLog.create({
        data: {
          adminUserId: admin.id,
          action: 'PAYOUT_APPROVE',
          targetType: 'PayoutRequest',
          targetId: id,
          metadataJson: { reason: note.slice(0, 1000), previousStatus: payout.status },
        },
      });
      return this.toAdminDto(updated);
    });
  }

  async reject(admin: AdminActor, id: string, reason: string) {
    const note = reason.trim();
    if (!note) throw new BadRequestException('Укажите причину отклонения.');
    return withSerializableTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PayoutRequest" WHERE "id" = ${id} FOR UPDATE`;
      const payout = await tx.payoutRequest.findUnique({ where: { id } });
      if (!payout) throw new NotFoundException('Заявка на вывод не найдена.');
      if (payout.status === 'REJECTED') return this.toAdminDto(payout);
      if (!REJECTABLE.has(payout.status)) {
        throw new ConflictException(`Нельзя отклонить заявку в статусе ${payout.status}.`);
      }
      await lockUsersInIdOrder(tx, [payout.userId]);
      const refund = await this.balance.credit(
        tx,
        payout.userId,
        payout.amountCents,
        'WITHDRAWAL_REVERSAL',
        {
          idempotencyKey: `payout:${payout.id}:reversal`,
          description: `Возврат отклонённого вывода: ${note}`.slice(0, 500),
          source: 'ADMIN',
          correlationId: `payout-reject:${payout.id}`.slice(0, 64),
          fundKind: 'USER_OWNED',
        },
      );
      const updated = await tx.payoutRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewReason: note.slice(0, 1000),
          reviewedAt: new Date(),
          rejectedAt: new Date(),
          refundLedgerEntryId: refund.id,
        },
      });
      await tx.adminActionLog.create({
        data: {
          adminUserId: admin.id,
          action: 'PAYOUT_REJECT_REFUND',
          targetType: 'PayoutRequest',
          targetId: id,
          metadataJson: {
            reason: note.slice(0, 1000),
            previousStatus: payout.status,
            refundLedgerEntryId: refund.id.toString(),
            refundIdempotencyKey: `payout:${payout.id}:reversal`,
          },
        },
      });
      return this.toAdminDto(updated);
    });
  }

  toAdminDto(payout: {
    id: string;
    userId: bigint;
    withdrawalLedgerEntryId: bigint;
    refundLedgerEntryId: bigint | null;
    status: PayoutRequestStatus;
    provider: string;
    amountCents: bigint;
    currency: string;
    destinationFingerprint: string | null;
    riskReasons: Prisma.JsonValue | null;
    reviewReason: string | null;
    requestedAt: Date;
    reviewedAt: Date | null;
    processingStartedAt: Date | null;
    paidAt: Date | null;
    failedAt: Date | null;
    rejectedAt: Date | null;
  }) {
    return {
      ...payout,
      userId: payout.userId.toString(),
      withdrawalLedgerEntryId: payout.withdrawalLedgerEntryId.toString(),
      refundLedgerEntryId: payout.refundLedgerEntryId?.toString() ?? null,
      amountCents: payout.amountCents.toString(),
      requestedAt: payout.requestedAt.toISOString(),
      reviewedAt: payout.reviewedAt?.toISOString() ?? null,
      processingStartedAt: payout.processingStartedAt?.toISOString() ?? null,
      paidAt: payout.paidAt?.toISOString() ?? null,
      failedAt: payout.failedAt?.toISOString() ?? null,
      rejectedAt: payout.rejectedAt?.toISOString() ?? null,
    };
  }
}
