import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { banDurationDaysForStrike } from '../ban-policy';
import { createDomainNotification } from '../domain-notify';
import { formatOnixId } from '../onix-id';
import { RiskScoreService } from '../risk-score.service';
import { PrismaService } from '../prisma.service';
import { BalanceService } from '../economy/wallet/balance.service';

type Tx = Prisma.TransactionClient;

const AUTO_BAN_COMMENT =
  'Автоматическая блокировка: поступили деньги от продажи по подтверждённой жалобе.';

/**
 * Admin fraud marker: "do not ban yet — wait for the money".
 *
 * The gap this closes: a complaint is confirmed, but the account has no balance, so
 * banning it repays nobody and just pushes the seller onto a fresh account. Instead the
 * marker keeps SELLING OPEN so the seller can still earn, and the first completed sale
 * payout is intercepted inside that payout's own transaction:
 *
 *   1. repay the admin-declared victim from the proceeds (partial if they are short);
 *   2. freeze what remains (`withdrawBlockedAt`) so it cannot be withdrawn post-commit;
 *   3. after COMMIT, ban with strike escalation and arm the registration filter.
 *
 * Deliberate limits:
 * - selling is NOT banned while armed, because that would freeze the debt forever;
 * - the trigger is a SALE payout only, not a deposit: deposited own funds are not fraud
 *   proceeds and seizing them would be confiscation without a decision;
 * - the victim is admin-declared, never inferred. Order refunds already credit the buyer
 *   immediately (EscrowService.refund), so a claim here is only for fraud the order flow
 *   did NOT cover. Declaring one that was already refunded would pay twice;
 * - the ban lands after COMMIT, so a failure here can never roll back a payout.
 */
@Injectable()
export class FraudWatchService {
  private readonly logger = new Logger(FraudWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly balance: BalanceService,
    /** Marker arming needs AbuseMarkers; absent only in bare unit construction. */
    @Optional() private readonly risk?: RiskScoreService,
  ) {}

  /**
   * Consume the marker inside the payout transaction.
   *
   * Repayment and freezing must be atomic with the payout: between COMMIT and the ban the
   * account is still usable, so anything not taken or frozen here can be withdrawn.
   */
  async consumeOnPayout(
    tx: Tx,
    sellerId: bigint,
    orderId: bigint,
    payoutCents: bigint,
  ): Promise<{ armed: boolean; notifyId: bigint | null; repaidCents: bigint; frozenCents: bigint }> {
    const none = { armed: false as const, notifyId: null, repaidCents: 0n, frozenCents: 0n };
    /**
     * No payout, no interception. Without this guard a zero-amount call would still write
     * ledger/security rows against an order that may not exist, and would consume the
     * marker without ever repaying anyone.
     */
    if (payoutCents <= 0n) return none;
    const user = await tx.user.findUnique({
      where: { id: sellerId },
      select: {
        fraudWatchAt: true,
        fraudWatchReason: true,
        fraudWatchVictimUserId: true,
        fraudWatchClaimCents: true,
        deletedAt: true,
        onixId: true,
      },
    });
    if (!user?.fraudWatchAt || user.deletedAt) return none;

    const now = new Date();
    const reason = user.fraudWatchReason ?? 'Подтверждённая жалоба';

    // 1. Repay the declared victim first: the point of waiting for the money.
    const victimId = user.fraudWatchVictimUserId;
    const claim = user.fraudWatchClaimCents > 0n ? user.fraudWatchClaimCents : 0n;
    let repaidCents = 0n;
    if (victimId != null && claim > 0n) {
      const victim = await tx.user.findUnique({
        where: { id: victimId },
        select: { id: true, deletedAt: true },
      });
      if (victim && !victim.deletedAt) {
        // getAvailable throws for a deleted seller, so read the balance directly here:
        // the seller is about to be banned and may already carry a tombstone.
        const seller = await tx.user.findUniqueOrThrow({
          where: { id: sellerId },
          select: { balanceCents: true },
        });
        const take = seller.balanceCents < claim ? seller.balanceCents : claim;
        if (take > 0n) {
          await this.balance.debit(tx, sellerId, take, 'CLAWBACK', {
            idempotencyKey: `fraud-watch:${orderId}:claim:${user.fraudWatchAt.getTime()}`,
            orderId,
            description: `Возмещение пострадавшему по жалобе: ${reason}`,
            source: 'SYSTEM',
            fundKind: 'SALE_PROCEEDS',
          });
          await this.balance.credit(tx, victimId, take, 'REFUND', {
            idempotencyKey: `fraud-watch:${orderId}:repay:${user.fraudWatchAt.getTime()}`,
            orderId,
            description: `Возмещение по жалобе от ${formatOnixId(user.onixId)}`,
            source: 'SYSTEM',
            fundKind: 'USER_OWNED',
            actorUserId: sellerId,
          });
          repaidCents = take;
        }
      } else {
        // Wiped or missing victim: do NOT invent a recipient. Leave the money frozen and
        // let support pay it out manually.
        await tx.securityEvent.create({
          data: {
            userId: sellerId,
            type: 'FRAUD_WATCH_TRIGGERED',
            status: 'OPEN',
            severity: 70,
            payload: {
              kind: 'VICTIM_UNAVAILABLE',
              victimUserId: victimId?.toString() ?? null,
              claimCents: claim.toString(),
              reason: 'victim wiped or missing — payout held for manual support action',
            },
          },
        });
      }
    }

    // 2. Freeze the remainder and disarm, so nothing can leave before the ban commits.
    await tx.user.update({
      where: { id: sellerId },
      data: {
        fraudWatchAt: null,
        fraudWatchReason: null,
        fraudWatchVictimUserId: null,
        fraudWatchClaimCents: 0n,
        withdrawBlockedAt: now,
        suspiciousFundsHoldAt: now,
      },
    });

    await tx.securityEvent.create({
      data: {
        userId: sellerId,
        type: 'FRAUD_WATCH_TRIGGERED',
        status: 'OPEN',
        severity: 90,
        payload: {
          kind: 'SALE_PAYOUT_INTERCEPTED',
          orderId: orderId.toString(),
          payoutCents: payoutCents.toString(),
          repaidCents: repaidCents.toString(),
          claimCents: claim.toString(),
          victimUserId: victimId?.toString() ?? null,
          reason,
          armedAt: user.fraudWatchAt.toISOString(),
        },
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: null,
        action: 'FRAUD_WATCH_TRIGGERED',
        entity: 'User',
        entityId: sellerId.toString(),
        metadata: {
          orderId: orderId.toString(),
          payoutCents: payoutCents.toString(),
          repaidCents: repaidCents.toString(),
          claimCents: claim.toString(),
          victimUserId: victimId?.toString() ?? null,
          reason,
        },
      },
    });

    const note = await createDomainNotification(tx, {
      userId: sellerId,
      type: 'SYSTEM',
      title: 'Аккаунт заблокирован',
      body: `${AUTO_BAN_COMMENT} Причина: ${reason}`,
      data: { orderId: orderId.toString(), kind: 'FRAUD_WATCH' },
    });

    this.logger.warn(JSON.stringify({
      msg: 'fraud_watch_triggered',
      userId: sellerId.toString(),
      orderId: orderId.toString(),
      payoutCents: payoutCents.toString(),
      repaidCents: repaidCents.toString(),
      claimCents: claim.toString(),
    }));

    return {
      armed: true,
      notifyId: note.id,
      repaidCents,
      frozenCents: payoutCents > repaidCents ? payoutCents - repaidCents : 0n,
    };
  }

  /**
   * Apply the ban after COMMIT.
   *
   * Recovery/repayment already ran inside the payout transaction and had to: the balance
   * debit path refuses a deleted account, so repaying after the ban would move nothing.
   */
  async enforceBanAfterCommit(sellerId: bigint, orderId: bigint): Promise<{ banned: boolean }> {
    const now = new Date();
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: sellerId },
          select: { id: true, onixId: true, deletedAt: true, banStrikeCount: true },
        });
        if (!user || user.deletedAt) return null;

        const priorStrikes = Math.max(0, user.banStrikeCount);
        const days = banDurationDaysForStrike('FRAUD', priorStrikes);
        const bannedUntil = days == null ? null : new Date(now.getTime() + days * 86_400_000);

        const updated = await tx.user.update({
          where: { id: sellerId },
          data: {
            deletedAt: now,
            bannedAt: now,
            bannedUntil,
            banReason: 'FRAUD',
            banComment: AUTO_BAN_COMMENT.slice(0, 1000),
            banStrikeCount: priorStrikes + 1,
            fraudWatchAt: null,
            fraudWatchReason: null,
            fraudWatchVictimUserId: null,
            fraudWatchClaimCents: 0n,
            sessionVersion: { increment: 1 },
          },
        });
        await tx.session.updateMany({
          where: { userId: sellerId, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'SECURITY' },
        });
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: 'FRAUD_WATCH_AUTO_BAN',
            entity: 'User',
            entityId: sellerId.toString(),
            metadata: {
              onixId: formatOnixId(user.onixId),
              orderId: orderId.toString(),
              permanent: days == null,
              strike: priorStrikes + 1,
            },
          },
        });
        return updated;
      });

      if (!result) return { banned: false };

      /**
       * Arm the registration filter so the replacement account is refused at signup even
       * on a new IP: FINGERPRINT is derived from stable browser/PWA signals only, and
       * TELEGRAM_ID / PHONE_HASH survive an address change entirely.
       */
      await this.risk?.recordBanMarkers(this.prisma, sellerId);
      return { banned: true };
    } catch (error) {
      // Proceeds are already frozen by consumeOnPayout, so a failure here is recoverable
      // by support rather than a loss of funds. Loud, not silent.
      this.logger.error(JSON.stringify({
        msg: 'fraud watch auto-ban failed',
        userId: sellerId.toString(),
        orderId: orderId.toString(),
        error: error instanceof Error ? error.message : String(error),
      }));
      return { banned: false };
    }
  }
}