import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common';
import { PrismaService } from '../../prisma.service';
import { createId } from '../wallet/cuid';

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dayKey(d: Date): string {
  return utcDay(d).toISOString().slice(0, 10);
}

/**
 * Seller analytics: on-demand rollup into SellerAnalyticsDaily + owner read API.
 */
@Injectable()
export class SellerAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwnerAnalytics(user: AuthUser, daysRaw?: number) {
    const days = Math.min(90, Math.max(7, Number(daysRaw) || 30));
    const end = utcDay(new Date());
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    await this.rollupRange(user.id, start, end);

    const rows = await this.prisma.sellerAnalyticsDaily.findMany({
      where: { sellerId: user.id, day: { gte: start, lte: end } },
      orderBy: { day: 'asc' },
    });

    const byDay = new Map(rows.map((r) => [dayKey(r.day), r]));
    const series: Array<{
      day: string;
      uniqueViews: number;
      ordersCount: number;
      completedCount: number;
      revenueCents: string;
      profitCents: string;
      favoritesAdded: number;
    }> = [];

    let uniqueViews = 0;
    let ordersCount = 0;
    let completedCount = 0;
    let revenueCents = 0n;
    let profitCents = 0n;
    let favoritesAdded = 0;

    for (let i = 0; i < days; i += 1) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = dayKey(d);
      const row = byDay.get(key);
      const views = row?.uniqueViews ?? 0;
      const orders = row?.ordersCount ?? 0;
      const completed = row?.completedCount ?? 0;
      const revenue = row?.revenueCents ?? 0n;
      const profit = row?.profitCents ?? 0n;
      const favs = row?.favoritesAdded ?? 0;
      uniqueViews += views;
      ordersCount += orders;
      completedCount += completed;
      revenueCents += revenue;
      profitCents += profit;
      favoritesAdded += favs;
      series.push({
        day: key,
        uniqueViews: views,
        ordersCount: orders,
        completedCount: completed,
        revenueCents: revenue.toString(),
        profitCents: profit.toString(),
        favoritesAdded: favs,
      });
    }

    return {
      days,
      from: dayKey(start),
      to: dayKey(end),
      totals: {
        uniqueViews,
        ordersCount,
        completedCount,
        revenueCents: revenueCents.toString(),
        profitCents: profitCents.toString(),
        favoritesAdded,
      },
      series,
    };
  }

  /** Recompute daily rollups for [fromDay, toDay] inclusive (UTC dates). */
  async rollupRange(sellerId: bigint, fromDay: Date, toDay: Date) {
    const from = utcDay(fromDay);
    const to = utcDay(toDay);
    const toExclusive = new Date(to);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

    const [views, orders, favorites] = await Promise.all([
      this.prisma.productViewUnique.findMany({
        where: {
          sellerId,
          firstSeenAt: { gte: from, lt: toExclusive },
        },
        select: { firstSeenAt: true },
      }),
      this.prisma.order.findMany({
        where: {
          sellerId,
          createdAt: { gte: from, lt: toExclusive },
        },
        select: {
          status: true,
          totalAmountCents: true,
          payoutCents: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      this.prisma.favorite.findMany({
        where: {
          createdAt: { gte: from, lt: toExclusive },
          product: { sellerId },
        },
        select: { createdAt: true },
      }),
    ]);

    type Acc = {
      uniqueViews: number;
      ordersCount: number;
      completedCount: number;
      revenueCents: bigint;
      profitCents: bigint;
      favoritesAdded: number;
    };
    const acc = new Map<string, Acc>();
    const bump = (key: string): Acc => {
      let row = acc.get(key);
      if (!row) {
        row = {
          uniqueViews: 0,
          ordersCount: 0,
          completedCount: 0,
          revenueCents: 0n,
          profitCents: 0n,
          favoritesAdded: 0,
        };
        acc.set(key, row);
      }
      return row;
    };

    for (const v of views) bump(dayKey(v.firstSeenAt)).uniqueViews += 1;
    for (const o of orders) {
      const row = bump(dayKey(o.createdAt));
      row.ordersCount += 1;
      if (o.status === 'COMPLETED') {
        const cKey = dayKey(o.completedAt ?? o.createdAt);
        const cRow = bump(cKey);
        cRow.completedCount += 1;
        cRow.revenueCents += o.totalAmountCents;
        cRow.profitCents += o.payoutCents;
      }
    }
    for (const f of favorites) bump(dayKey(f.createdAt)).favoritesAdded += 1;

    // Ensure empty days exist in map for upsert clarity — skip zeros (lazy).
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const [key, row] of acc) {
      const day = new Date(`${key}T00:00:00.000Z`);
      ops.push(
        this.prisma.sellerAnalyticsDaily.upsert({
          where: { sellerId_day: { sellerId, day } },
          create: {
            id: createId(),
            sellerId,
            day,
            uniqueViews: row.uniqueViews,
            ordersCount: row.ordersCount,
            completedCount: row.completedCount,
            revenueCents: row.revenueCents,
            profitCents: row.profitCents,
            favoritesAdded: row.favoritesAdded,
          },
          update: {
            uniqueViews: row.uniqueViews,
            ordersCount: row.ordersCount,
            completedCount: row.completedCount,
            revenueCents: row.revenueCents,
            profitCents: row.profitCents,
            favoritesAdded: row.favoritesAdded,
          },
        }),
      );
    }
    if (ops.length) await this.prisma.$transaction(ops);
  }
}
