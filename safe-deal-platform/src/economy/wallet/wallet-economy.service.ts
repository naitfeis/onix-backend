import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common';
import { PrismaService } from '../../prisma.service';
import { requireUserByOnixId } from '../../onix-id-lookup';
import { BalanceService } from './balance.service';
import { DepositService } from './deposit.service';
import { LockService } from './lock.service';
import { TrustService } from '../trust/trust.service';
import { assertNoTrustScore, buildPublicTrustCard } from '../trust/trust-card';
import { ProSubscriptionService } from '../pro/pro.service';
import { VerificationService } from '../verification/verification.service';

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

@Injectable()
export class WalletEconomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balance: BalanceService,
    private readonly deposit: DepositService,
    private readonly locks: LockService,
    private readonly trust: TrustService,
    private readonly verification: VerificationService,
    private readonly pro: ProSubscriptionService,
  ) {}

  /** Owner deposit view — runs lazy unlock first. */
  async getDepositWallet(user: AuthUser) {
    await this.prisma.$transaction(async (tx) => {
      await this.locks.releaseExpiredForUser(tx, user.id);
    }, SERIALIZABLE);
    const snap = await this.prisma.$transaction((tx) => this.deposit.getSnapshot(tx, user.id));
    return {
      availableCents: snap.availableCents.toString(),
      lockedCents: snap.lockedCents.toString(),
      totalCents: snap.totalCents.toString(),
    };
  }

  async listDepositLedger(user: AuthUser) {
    const rows = await this.prisma.depositLedgerEntry.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      type: r.type,
      amountCents: r.amountCents.toString(),
      availableAfterCents: r.availableAfterCents.toString(),
      lockedAfterCents: r.lockedAfterCents.toString(),
      orderId: r.orderId?.toString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async listLocks(user: AuthUser) {
    await this.prisma.$transaction(async (tx) => {
      await this.locks.releaseExpiredForUser(tx, user.id);
    }, SERIALIZABLE);
    const rows = await this.prisma.depositLock.findMany({
      where: { userId: user.id, status: { in: ['ACTIVE', 'HELD_DISPUTE'] } },
      orderBy: { unlockAt: 'asc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      orderId: r.orderId.toString(),
      amountCents: r.amountCents.toString(),
      status: r.status,
      lockedAt: r.lockedAt.toISOString(),
      unlockAt: r.unlockAt.toISOString(),
    }));
  }

  /** Main balance → deposit available (locked untouched). */
  async fundDepositFromBalance(user: AuthUser, amountCents: number, idempotencyKey: string) {
    if (amountCents < 100) throw new BadRequestException('Минимальная сумма пополнения залога — 1 ₽.');
    const amount = BigInt(amountCents);
    return this.prisma.$transaction(async (tx) => {
      await this.locks.releaseExpiredForUser(tx, user.id);
      const existing = await tx.depositLedgerEntry.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.userId !== user.id || existing.type !== 'TOPUP' || existing.amountCents !== amount) {
          throw new ConflictException('Ключ идемпотентности уже использован.');
        }
        return {
          depositEntryId: existing.id.toString(),
          amountCents: amount.toString(),
        };
      }
      await this.balance.debit(tx, user.id, amount, 'DEPOSIT_FUND', {
        idempotencyKey: `bal:${idempotencyKey}`,
        description: 'Перевод в залог',
        actorUserId: user.id,
        source: 'USER',
      });
      const entry = await this.deposit.creditAvailable(tx, user.id, amount, 'TOPUP', {
        idempotencyKey,
        description: 'Пополнение залога с баланса',
      });
      await this.trust.appendHistory(tx, user.id, 'DEPOSIT_CHANGED', {
        deltaCents: amount.toString(),
        reason: 'FUND_FROM_BALANCE',
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'DEPOSIT_FUND',
          entity: 'DepositLedgerEntry',
          entityId: entry.id.toString(),
          metadata: { amountCents },
        },
      });
      return {
        depositEntryId: entry.id.toString(),
        amountCents: amount.toString(),
      };
    }, SERIALIZABLE);
  }

  /** Deposit available → main balance. Locked deposit cannot be withdrawn. */
  async withdrawDeposit(user: AuthUser, amountCents: number, idempotencyKey: string) {
    if (amountCents < 100) throw new BadRequestException('Минимальная сумма вывода залога — 1 ₽.');
    const amount = BigInt(amountCents);
    return this.prisma.$transaction(async (tx) => {
      await this.locks.releaseExpiredForUser(tx, user.id);
      const existing = await tx.depositLedgerEntry.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.userId !== user.id || existing.type !== 'WITHDRAW' || existing.amountCents !== -amount) {
          throw new ConflictException('Ключ идемпотентности уже использован.');
        }
        return {
          depositEntryId: existing.id.toString(),
          amountCents: amount.toString(),
        };
      }
      const entry = await this.deposit.debitAvailable(tx, user.id, amount, 'WITHDRAW', {
        idempotencyKey,
        description: 'Вывод залога на баланс',
      });
      await this.balance.credit(tx, user.id, amount, 'DEPOSIT_RETURN', {
        idempotencyKey: `bal:${idempotencyKey}`,
        description: 'Возврат из залога',
        actorUserId: user.id,
        source: 'USER',
      });
      await this.trust.appendHistory(tx, user.id, 'DEPOSIT_CHANGED', {
        deltaCents: (-amount).toString(),
        reason: 'WITHDRAW_TO_BALANCE',
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'DEPOSIT_WITHDRAWAL',
          entity: 'DepositLedgerEntry',
          entityId: entry.id.toString(),
          metadata: { amountCents },
        },
      });
      return {
        depositEntryId: entry.id.toString(),
        amountCents: amount.toString(),
      };
    }, SERIALIZABLE);
  }

  async getPublicTrustCard(onixId: string) {
    const user = await requireUserByOnixId(this.prisma, onixId);
    const full = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        deletedAt: true,
        trustLevel: true,
        depositAvailableCents: true,
        depositLockedCents: true,
        createdAt: true,
        ratingAverage: true,
        ratingCount: true,
        completedSales: true,
        verifications: { select: { kind: true, status: true } },
        sellerSubscription: { select: { status: true, endsAt: true } },
      },
    });
    if (full.deletedAt) throw new NotFoundException('Профиль не найден.');
    const proActive = Boolean(
      full.sellerSubscription
      && full.sellerSubscription.status === 'ACTIVE'
      && (!full.sellerSubscription.endsAt || full.sellerSubscription.endsAt > new Date()),
    );
    const card = buildPublicTrustCard({
      trustLevel: full.trustLevel,
      depositAvailableCents: full.depositAvailableCents,
      depositLockedCents: full.depositLockedCents,
      createdAt: full.createdAt,
      ratingAverage: full.ratingAverage,
      ratingCount: full.ratingCount,
      completedSales: full.completedSales,
      verifications: full.verifications,
      proActive,
    });
    assertNoTrustScore(card);
    return card;
  }

  async getOwnerTrust(user: AuthUser) {
    await this.trust.ensureFresh(user.id);
    const [profile, history, verifications, pro, deposit] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          trustScore: true,
          trustLevel: true,
          trustScoreVersion: true,
          trustComputedAt: true,
          depositAvailableCents: true,
          depositLockedCents: true,
          createdAt: true,
          ratingAverage: true,
          ratingCount: true,
          completedSales: true,
        },
      }),
      this.prisma.trustHistoryEvent.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.verification.list(user.id),
      this.pro.getStatus(user.id),
      this.getDepositWallet(user),
    ]);
    return {
      trustScore: profile.trustScore,
      trustLevel: profile.trustLevel,
      trustScoreVersion: profile.trustScoreVersion,
      trustComputedAt: profile.trustComputedAt?.toISOString() ?? null,
      deposit,
      card: buildPublicTrustCard({
        trustLevel: profile.trustLevel,
        depositAvailableCents: profile.depositAvailableCents,
        depositLockedCents: profile.depositLockedCents,
        createdAt: profile.createdAt,
        ratingAverage: profile.ratingAverage,
        ratingCount: profile.ratingCount,
        completedSales: profile.completedSales,
        verifications,
        proActive: pro.active,
      }),
      verifications,
      pro,
      history: history.map((h) => ({
        id: h.id.toString(),
        type: h.type,
        payload: h.payload,
        createdAt: h.createdAt.toISOString(),
      })),
    };
  }
}
