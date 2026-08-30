import { Injectable } from '@nestjs/common';
import type { Prisma, TrustHistoryType } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import type { Tx } from '../wallet/deposit.service';

export type TrustBreakdown = {
  accountAge: number;
  completedSales: number;
  reviews: number;
  successRate: number;
  deposit: number;
  activity: number;
  penalties: number;
  raw: number;
  score: number;
  level: number;
};

const FORMULA_VERSION = 2;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function levelFromScore(score: number): number {
  if (score >= 750) return 5;
  if (score >= 550) return 4;
  if (score >= 350) return 3;
  if (score >= 150) return 2;
  return 1;
}

function logCap(value: number, softMax: number, cap: number): number {
  if (value <= 0) return 0;
  const ratio = Math.log1p(value) / Math.log1p(softMax);
  return clamp(Math.round(ratio * cap), 0, cap);
}

/**
 * Internal Trust Score 0..1000 → public Trust Level 1..5.
 * Score is never returned on public seller endpoints.
 */
@Injectable()
export class TrustService {
  constructor(private readonly prisma: PrismaService) {}

  markDirty(tx: Tx, userId: bigint) {
    return tx.user.update({ where: { id: userId }, data: { trustDirty: true } });
  }

  async appendHistory(
    tx: Tx,
    userId: bigint,
    type: TrustHistoryType,
    payload?: Prisma.InputJsonObject,
  ) {
    return tx.trustHistoryEvent.create({
      data: { userId, type, payload: payload ?? undefined },
    });
  }

  async recompute(userId: bigint) {
    return this.prisma.$transaction(async (tx) => this.recomputeInTx(tx, userId));
  }

  async recomputeInTx(tx: Tx, userId: bigint) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        createdAt: true,
        completedSales: true,
        ratingAverage: true,
        ratingCount: true,
        depositAvailableCents: true,
        depositLockedCents: true,
        lastSeenAt: true,
        trustLevel: true,
        banReason: true,
      },
    });

    const [refunded, disputed] = await Promise.all([
      tx.order.count({ where: { sellerId: userId, status: 'REFUNDED' } }),
      tx.order.count({ where: { sellerId: userId, status: 'DISPUTE' } }),
    ]);

    const ageDays = Math.max(0, (Date.now() - user.createdAt.getTime()) / (86400 * 1000));
    const accountAge = logCap(ageDays, 365, 80);
    const completedSales = logCap(user.completedSales, 200, 180);
    const reviewCountPart = logCap(user.ratingCount, 100, 60);
    const ratingPart = clamp(Math.round((Number(user.ratingAverage) / 5) * 60), 0, 60);
    const reviews = reviewCountPart + ratingPart;

    const closed = user.completedSales + refunded;
    const successRate = closed <= 0
      ? 40
      : clamp(Math.round((user.completedSales / closed) * 180) - disputed * 15, 0, 180);

    const depositRub = Number(user.depositAvailableCents + user.depositLockedCents) / 100;
    const deposit = logCap(depositRub, 100_000, 150);

    const daysSinceSeen = Math.max(0, (Date.now() - user.lastSeenAt.getTime()) / (86400 * 1000));
    const activity = daysSinceSeen <= 3 ? 70 : daysSinceSeen <= 14 ? 40 : daysSinceSeen <= 45 ? 15 : 0;

    let penalties = disputed * 25 + refunded * 5;
    if (user.banReason) penalties += 200;
    penalties = clamp(penalties, 0, 1000);

    const raw = accountAge + completedSales + reviews + successRate + deposit + activity;
    const score = clamp(raw - penalties, 0, 1000);
    const level = levelFromScore(score);

    const prevLevel = user.trustLevel;
    await tx.user.update({
      where: { id: userId },
      data: {
        trustScore: score,
        trustLevel: level,
        trustScoreVersion: FORMULA_VERSION,
        trustComputedAt: new Date(),
        trustDirty: false,
      },
    });

    if (level > prevLevel) {
      await this.appendHistory(tx, userId, 'LEVEL_UP', { from: prevLevel, to: level, score });
    } else if (level < prevLevel) {
      await this.appendHistory(tx, userId, 'LEVEL_DOWN', { from: prevLevel, to: level, score });
    } else {
      await this.appendHistory(tx, userId, 'RECOMPUTE', { score, level });
    }

    const breakdown: TrustBreakdown = {
      accountAge, completedSales, reviews, successRate, deposit, activity, penalties, raw, score, level,
    };
    return breakdown;
  }

  async ensureFresh(userId: bigint) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { trustDirty: true, trustComputedAt: true },
    });
    const stale = !user.trustComputedAt
      || Date.now() - user.trustComputedAt.getTime() > 24 * 60 * 60 * 1000;
    if (user.trustDirty || stale) return this.recompute(userId);
    return null;
  }
}
