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

/** Monday 00:00 UTC of the week containing `d` (week ends Sunday). */
function mondayOfWeek(d: Date): Date {
  const day = utcDay(d);
  const dow = day.getUTCDay(); // 0=Sun … 6=Sat
  const fromMonday = dow === 0 ? 6 : dow - 1;
  day.setUTCDate(day.getUTCDate() - fromMonday);
  return day;
}

const WEEKDAY_RU = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const;

/**
 * Seller analytics: on-demand rollup + weekly owner read API (Mon–Sun, navigable).
 */
@Injectable()
export class SellerAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private static readonly ROLLUP_STALE_MS = 5 * 60_000;

  /**
   * @param weekOffset 0 = current week, -1 = previous, … (future weeks blocked)
   */
  async getOwnerAnalytics(user: AuthUser, weekOffsetRaw?: number) {
    const weekOffset = Math.min(0, Math.max(-52, Number.isFinite(Number(weekOffsetRaw)) ? Number(weekOffsetRaw) : 0));
    const thisMonday = mondayOfWeek(new Date());
    const start = new Date(thisMonday);
    start.setUTCDate(thisMonday.getUTCDate() + weekOffset * 7);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);

    if (await this.needsRollup(user.id, start, end, weekOffset)) {
      await this.rollupRange(user.id, start, end);
    }

    const rows = await this.prisma.sellerAnalyticsDaily.findMany({
      where: { sellerId: user.id, day: { gte: start, lte: end } },
      orderBy: { day: 'asc' },
    });

    const byDay = new Map(rows.map((r) => [dayKey(r.day), r]));
    const series: Array<{
      day: string;
      weekday: string;
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

    for (let i = 0; i < 7; i += 1) {
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
        weekday: WEEKDAY_RU[i]!,
        uniqueViews: views,
        ordersCount: orders,
        completedCount: completed,
        revenueCents: revenue.toString(),
        profitCents: profit.toString(),
        favoritesAdded: favs,
      });
    }

    const from = dayKey(start);
    const to = dayKey(end);
    return {
      mode: 'week' as const,
      days: 7,
      weekOffset,
      from,
      to,
      label: `${from.slice(5)} — ${to.slice(5)}`,
      canGoNext: weekOffset < 0,
      canGoPrev: weekOffset > -52,
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

  /**
   * Skip expensive rollup when data is fresh enough.
   * Past weeks: only if empty. Current week: missing days or stale > 5 min.
   */
  private async needsRollup(
    sellerId: bigint,
    start: Date,
    end: Date,
    weekOffset: number,
  ): Promise<boolean> {
    const rows = await this.prisma.sellerAnalyticsDaily.findMany({
      where: { sellerId, day: { gte: start, lte: end } },
      select: { day: true, updatedAt: true },
    });
    if (weekOffset < 0) {
      return rows.length === 0;
    }
    const today = utcDay(new Date());
    const lastNeeded = today < end ? today : end;
    let daysNeeded = 0;
    for (let d = new Date(start); d <= lastNeeded; d.setUTCDate(d.getUTCDate() + 1)) {
      daysNeeded += 1;
    }
    if (rows.length < daysNeeded) return true;
    const maxUpdated = rows.reduce(
      (max, r) => (r.updatedAt > max ? r.updatedAt : max),
      rows[0]!.updatedAt,
    );
    return Date.now() - maxUpdated.getTime() > SellerAnalyticsService.ROLLUP_STALE_MS;
  }

  /** Recompute daily rollups for [fromDay, toDay] inclusive (UTC dates). */
  async rollupRange(sellerId: bigint, fromDay: Date, toDay: Date) {
    const from = utcDay(fromDay);
    const to = utcDay(toDay);
    const toExclusive = new Date(to);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

    type AggregateRow = {
      day: Date;
      uniqueViews: number;
      ordersCount: number;
      completedCount: number;
      revenueCents: bigint;
      profitCents: bigint;
      favoritesAdded: number;
    };
    const rows = await this.prisma.$queryRaw<AggregateRow[]>`
      WITH days AS (
        SELECT generate_series(${from}::timestamp, ${to}::timestamp, interval '1 day')::date AS day
      ),
      views AS (
        SELECT ("firstSeenAt" AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS count
        FROM "ProductViewUnique"
        WHERE "sellerId" = ${sellerId} AND "firstSeenAt" >= ${from} AND "firstSeenAt" < ${toExclusive}
        GROUP BY 1
      ),
      created_orders AS (
        SELECT ("createdAt" AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS count
        FROM "Order"
        WHERE "sellerId" = ${sellerId} AND "createdAt" >= ${from} AND "createdAt" < ${toExclusive}
        GROUP BY 1
      ),
      completed_orders AS (
        SELECT
          ("completedAt" AT TIME ZONE 'UTC')::date AS day,
          COUNT(*)::int AS count,
          COALESCE(SUM("totalAmountCents"), 0)::bigint AS revenue,
          COALESCE(SUM("payoutCents"), 0)::bigint AS profit
        FROM "Order"
        WHERE "sellerId" = ${sellerId}
          AND "status" = 'COMPLETED'
          AND "completedAt" >= ${from}
          AND "completedAt" < ${toExclusive}
        GROUP BY 1
      ),
      favorites AS (
        SELECT (f."createdAt" AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS count
        FROM "Favorite" f
        JOIN "Product" p ON p."id" = f."productId"
        WHERE p."sellerId" = ${sellerId} AND f."createdAt" >= ${from} AND f."createdAt" < ${toExclusive}
        GROUP BY 1
      )
      SELECT
        days.day,
        COALESCE(views.count, 0)::int AS "uniqueViews",
        COALESCE(created_orders.count, 0)::int AS "ordersCount",
        COALESCE(completed_orders.count, 0)::int AS "completedCount",
        COALESCE(completed_orders.revenue, 0)::bigint AS "revenueCents",
        COALESCE(completed_orders.profit, 0)::bigint AS "profitCents",
        COALESCE(favorites.count, 0)::int AS "favoritesAdded"
      FROM days
      LEFT JOIN views USING (day)
      LEFT JOIN created_orders USING (day)
      LEFT JOIN completed_orders USING (day)
      LEFT JOIN favorites USING (day)
      ORDER BY days.day
    `;

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const row of rows) {
      const day = utcDay(row.day);
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
