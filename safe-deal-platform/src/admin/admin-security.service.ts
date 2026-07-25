import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isNewAccount } from '../economy/wallet/fund-provenance';
import { WithdrawVelocityService } from '../economy/wallet/withdraw-velocity';
import { formatOnixId } from '../onix-id';
import { PrismaService } from '../prisma.service';
import type { AdminActor } from './admin-session.service';

@Injectable()
export class AdminSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly withdrawVelocity: WithdrawVelocityService,
  ) {}

  async dashboard() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [withdrawals24h, securityEvents24h, openClawbacks, yellowFlags] = await Promise.all([
      this.prisma.ledgerEntry.count({
        where: { type: 'WITHDRAWAL', createdAt: { gte: since } },
      }),
      this.prisma.securityEvent.count({
        where: { createdAt: { gte: since } },
      }),
      this.prisma.orderClawback.count({
        where: { status: { in: ['OPEN', 'PARTIAL'] } },
      }),
      this.listSecurityFlags({ limit: 50 }),
    ]);
    return {
      windowHours: 24,
      withdrawals24h,
      securityEvents24h,
      openClawbacks,
      yellowFlagCount: yellowFlags.length,
    };
  }

  async listSecurityFlags(opts?: { limit?: number }) {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.user.findMany({
      where: { createdAt: { gte: cutoff }, deletedAt: null },
      select: { id: true, onixId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const flags: Array<Record<string, unknown>> = [];
    for (const user of candidates) {
      if (flags.length >= limit) break;
      const flag = await this.withdrawVelocity.resolveAccountSaleProtectionFlag(user.id);
      if (!flag) continue;
      flags.push({
        ...flag,
        onixId: formatOnixId(user.onixId),
        reason: 'New account received ACCOUNT sale proceeds',
        createdAt: user.createdAt.toISOString(),
        status: 'ACTIVE',
      });
    }
    return flags;
  }

  async getUserInvestigation(onixIdOrId: string) {
    const stripped = onixIdOrId.replace(/^ONIX-/i, '');
    const asBig = /^\d+$/.test(stripped) ? BigInt(stripped) : null;
    const user = await this.prisma.user.findFirst({
      where: asBig
        ? { OR: [{ id: asBig }, { onixId: stripped }] }
        : { onixId: stripped },
    });
    if (!user) return null;

    const [sessions, ledger, securityEvents, sales] = await Promise.all([
      this.prisma.session.findMany({
        where: { userId: user.id },
        orderBy: { lastSeenAt: 'desc' },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          lastSeenAt: true,
          revokedAt: true,
          ipAddress: true,
          country: true,
          browser: true,
          os: true,
          riskScore: true,
          fingerprintHash: true,
          userAgent: true,
        },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          type: true,
          amountCents: true,
          fundKind: true,
          saleKind: true,
          source: true,
          correlationId: true,
          createdAt: true,
          description: true,
        },
      }),
      this.prisma.securityEvent.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          type: true,
          severity: true,
          createdAt: true,
          ipAddress: true,
          country: true,
          metadata: true,
        },
      }),
      this.prisma.order.findMany({
        where: { sellerId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          totalAmountCents: true,
          payoutCents: true,
          createdAt: true,
          productId: true,
        },
      }),
    ]);

    const yellow = await this.withdrawVelocity.resolveAccountSaleProtectionFlag(user.id);

    return {
      profile: {
        id: user.id.toString(),
        onixId: formatOnixId(user.onixId),
        username: user.telegramNick ?? user.displayName,
        createdAt: user.createdAt.toISOString(),
        accountAgeDays: Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000),
        trustScore: user.trustScore,
        trustLevel: user.trustLevel,
        securityScore: user.securityScore,
        balanceCents: user.balanceCents.toString(),
        platformStatus: user.platformStatus,
        bannedAt: user.bannedAt?.toISOString() ?? null,
      },
      flags: yellow ? [yellow] : [],
      sessions: sessions.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        revokedAt: s.revokedAt?.toISOString() ?? null,
      })),
      ledger: ledger.map((e) => ({
        ...e,
        id: e.id.toString(),
        amountCents: e.amountCents.toString(),
        createdAt: e.createdAt.toISOString(),
      })),
      securityEvents: securityEvents.map((e) => ({
        ...e,
        id: e.id.toString(),
        createdAt: e.createdAt.toISOString(),
      })),
      sales: sales.map((o) => ({
        ...o,
        id: o.id.toString(),
        productId: o.productId.toString(),
        totalAmountCents: o.totalAmountCents.toString(),
        payoutCents: o.payoutCents.toString(),
        createdAt: o.createdAt.toISOString(),
      })),
    };
  }

  async listWithdrawals(opts?: { limit?: number }) {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { type: 'WITHDRAWAL' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        amountCents: true,
        fundKind: true,
        saleKind: true,
        source: true,
        correlationId: true,
        createdAt: true,
        description: true,
        user: { select: { onixId: true, createdAt: true } },
      },
    });

    const out: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const ageDays = Math.floor((Date.now() - row.user.createdAt.getTime()) / 86_400_000);
      const yellow = isNewAccount(row.user.createdAt)
        ? await this.withdrawVelocity.resolveAccountSaleProtectionFlag(row.userId)
        : null;
      out.push({
        id: row.id.toString(),
        userId: row.userId.toString(),
        onixId: formatOnixId(row.user.onixId),
        amountCents: (-row.amountCents).toString(),
        amountRub: (Number(-row.amountCents) / 100).toFixed(2),
        source: row.source,
        fundKind: row.fundKind,
        saleKind: row.saleKind,
        accountAgeDays: ageDays,
        status: yellow ? 'REVIEW' : 'RECORDED',
        flag: yellow?.code ?? null,
        createdAt: row.createdAt.toISOString(),
        correlationId: row.correlationId,
        description: row.description,
      });
    }
    return out;
  }

  async listRiskEvents(opts?: { limit?: number }) {
    const take = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const events = await this.prisma.securityEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        type: true,
        severity: true,
        userId: true,
        createdAt: true,
        ipAddress: true,
        country: true,
        metadata: true,
      },
    });
    return events.map((e) => ({
      ...e,
      id: e.id.toString(),
      userId: e.userId?.toString() ?? null,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  async logAction(
    actor: AdminActor,
    action: string,
    target?: { type?: string; id?: string; metadata?: Prisma.InputJsonValue },
  ): Promise<void> {
    await this.prisma.adminActionLog.create({
      data: {
        adminUserId: actor.id,
        action,
        targetType: target?.type ?? null,
        targetId: target?.id ?? null,
        metadataJson: target?.metadata ?? undefined,
      },
    });
  }
}
