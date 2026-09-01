import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentWallet, PlatformStatus, Prisma } from '@prisma/client';
import { isNewAccount } from '../economy/wallet/fund-provenance';
import { BAN_REASON_LABELS, banDurationDays } from '../ban-policy';
import type { AuthUser } from '../common';
import { createDomainNotification, deliverTelegramAfterCommit } from '../domain-notify';
import { BalanceService } from '../economy/wallet/balance.service';
import { PaymentsService } from '../economy/payments/payments.service';
import { ProSubscriptionService } from '../economy/pro/pro.service';
import { WithdrawVelocityService } from '../economy/wallet/withdraw-velocity';
import { EscrowService } from '../escrow.module';
import { formatOnixId } from '../onix-id';
import { flagsFromPlatformStatus, isPlatformStatus } from '../platform-status';
import { PrismaService } from '../prisma.service';
import type { AdminActor } from './admin-session.service';
import { recomputeSellerRating } from '../marketplace/review-aggregate';

const ALLOWED_PLATFORM_STATUS_TRANSITIONS: Readonly<Record<PlatformStatus, ReadonlySet<PlatformStatus>>> = {
  USER: new Set(['VERIFIED_SELLER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN', 'VIP']),
  VERIFIED_SELLER: new Set(['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN', 'VIP']),
  MODERATOR: new Set(['USER', 'VERIFIED_SELLER', 'ADMIN', 'SUPER_ADMIN', 'VIP']),
  ADMIN: new Set(['USER', 'VERIFIED_SELLER', 'MODERATOR', 'SUPER_ADMIN', 'VIP']),
  SUPER_ADMIN: new Set(['USER', 'VERIFIED_SELLER', 'MODERATOR', 'ADMIN', 'VIP']),
  VIP: new Set(['USER', 'VERIFIED_SELLER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN']),
};

@Injectable()
export class AdminSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly withdrawVelocity: WithdrawVelocityService,
    private readonly balance: BalanceService,
    private readonly escrow: EscrowService,
    private readonly payments: PaymentsService,
    private readonly pro: ProSubscriptionService,
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
        ? { OR: [{ id: asBig }, { telegramId: asBig }, { onixId: stripped }] }
        : { onixId: stripped },
    });
    if (!user) return null;

    const [sessions, ledger, securityEvents, sales, pro] = await Promise.all([
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
          payload: true,
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
      this.prisma.sellerSubscription.findUnique({
        where: { userId: user.id },
        select: { plan: true, status: true, startsAt: true, endsAt: true },
      }),
    ]);

    const [purchases, chats] = await Promise.all([
      this.prisma.order.findMany({
        where: { buyerId: user.id }, orderBy: { createdAt: 'desc' }, take: 50,
        select: { id: true, status: true, totalAmountCents: true, createdAt: true, product: { select: { title: true } }, seller: { select: { onixId: true } } },
      }),
      this.prisma.chat.findMany({
        where: { members: { some: { userId: user.id } } }, orderBy: { updatedAt: 'desc' }, take: 50,
        select: { id: true, kind: true, title: true, updatedAt: true, members: { select: { userId: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { text: true, createdAt: true } } },
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
        bannedUntil: user.bannedUntil?.toISOString() ?? null,
        sellBannedAt: user.sellBannedAt?.toISOString() ?? null,
      },
      pro: pro
        ? {
            ...pro,
            active: pro.status === 'ACTIVE' && (!pro.endsAt || pro.endsAt > new Date()),
            startsAt: pro.startsAt.toISOString(),
            endsAt: pro.endsAt?.toISOString() ?? null,
          }
        : { active: false, plan: null, status: null, startsAt: null, endsAt: null },
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
      purchases: purchases.map((o) => ({ ...o, id: o.id.toString(), totalAmountCents: o.totalAmountCents.toString(), createdAt: o.createdAt.toISOString(), seller: { onixId: formatOnixId(o.seller.onixId) } })),
      chats: chats.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString(), memberIds: c.members.map((m) => m.userId.toString()), lastMessage: c.messages[0] ? { ...c.messages[0], createdAt: c.messages[0].createdAt.toISOString() } : null })),
    };
  }

  private async resolveTarget(onixIdOrId: string) {
    const stripped = onixIdOrId.replace(/^ONIX-/i, '');
    const asBig = /^\d+$/.test(stripped) ? BigInt(stripped) : null;
    const user = await this.prisma.user.findFirst({
      where: asBig ? { OR: [{ id: asBig }, { telegramId: asBig }, { onixId: stripped }] } : { onixId: stripped },
    });
    if (!user) throw new BadRequestException('???????????? ?? ??????.');
    return user;
  }

  private async runAuditedAdminAction<T>(
    actor: AdminActor,
    action: string,
    target: { type: string; id: string },
    metadata: Record<string, unknown>,
    operation: () => Promise<T>,
    completedMetadata?: (result: T) => Record<string, unknown>,
  ): Promise<T> {
    const audit = await this.prisma.adminActionLog.create({
      data: {
        adminUserId: actor.id,
        action: `${action}_PENDING`,
        targetType: target.type,
        targetId: target.id,
        metadataJson: { ...metadata, state: 'PENDING' } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      await this.prisma.adminActionLog.update({
        where: { id: audit.id },
        data: {
          action,
          metadataJson: {
            ...metadata,
            state: 'FAILED',
            error: error instanceof Error ? error.message.slice(0, 500) : 'Admin mutation failed',
          } as Prisma.InputJsonValue,
        },
      }).catch(() => undefined);
      throw error;
    }
    await this.prisma.adminActionLog.update({
      where: { id: audit.id },
      data: {
        action,
        metadataJson: {
          ...metadata,
          ...completedMetadata?.(result),
          state: 'COMPLETED',
        } as Prisma.InputJsonValue,
      },
    }).catch(() => undefined);
    return result;
  }

  async grantPro(actor: AdminActor, targetId: string, endsAt?: string) {
    const target = await this.resolveTarget(targetId);
    const parsedEndsAt = endsAt ? new Date(endsAt) : undefined;
    return this.runAuditedAdminAction(
      actor,
      'ADMIN_PRO_GRANT',
      { type: 'User', id: target.id.toString() },
      { onixId: formatOnixId(target.onixId), endsAt: parsedEndsAt?.toISOString() ?? null },
      () => this.pro.grantFromAdminPlane(target.id, parsedEndsAt),
      (subscription) => ({ subscriptionId: subscription.id }),
    );
  }

  async revokePro(actor: AdminActor, targetId: string) {
    const target = await this.resolveTarget(targetId);
    return this.runAuditedAdminAction(
      actor,
      'ADMIN_PRO_REVOKE',
      { type: 'User', id: target.id.toString() },
      { onixId: formatOnixId(target.onixId) },
      () => this.pro.revokeFromAdminPlane(target.id),
      (subscription) => ({ subscriptionId: subscription.id }),
    );
  }

  async createManualPayment(
    actor: AdminActor,
    targetId: string,
    input: { wallet: PaymentWallet; amountCents: number; idempotencyKey: string },
  ) {
    const target = await this.resolveTarget(targetId);
    const intent = await this.runAuditedAdminAction(
      actor,
      'ADMIN_MANUAL_PAYMENT_CREATE',
      { type: 'User', id: target.id.toString() },
      {
        onixId: formatOnixId(target.onixId),
        wallet: input.wallet,
        amountCents: input.amountCents,
        idempotencyKey: input.idempotencyKey,
      },
      () => this.payments.createManualTopUpForAdmin(target.id, input),
      (created) => ({ paymentIntentId: created.id }),
    );
    return {
      ...intent,
      userId: intent.userId.toString(),
      amountCents: intent.amountCents.toString(),
    };
  }

  async confirmManualPayment(actor: AdminActor, intentId: string) {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      select: { id: true, userId: true, provider: true },
    });
    if (!intent) throw new NotFoundException('Платёж не найден.');
    if (intent.provider !== 'MANUAL') {
      throw new BadRequestException('Подтверждать через admin control plane можно только MANUAL-платежи.');
    }
    const confirmed = await this.runAuditedAdminAction(
      actor,
      'ADMIN_MANUAL_PAYMENT_CONFIRM',
      { type: 'PaymentIntent', id: intent.id },
      { targetUserId: intent.userId.toString(), provider: intent.provider },
      () => this.payments.confirmManualForAdmin(intent.id, actor.id),
    );
    return {
      ...confirmed,
      userId: confirmed.userId.toString(),
      amountCents: confirmed.amountCents.toString(),
    };
  }

  async banUser(actor: AdminActor, targetId: string, input: { reason: string; comment: string; durationDays?: number }) {
    const target = await this.resolveTarget(targetId);
    if (!input.comment?.trim()) throw new BadRequestException('??????? ????? ??????? ??????????.');
    const reason = input.reason as 'MISCONDUCT' | 'THIRD_PARTY_ADS' | 'OFF_PLATFORM_DEAL' | 'FRAUD' | 'OTHER';
    if (!Object.prototype.hasOwnProperty.call(BAN_REASON_LABELS, reason)) throw new BadRequestException('???????????? ??????? ??????????.');
    const days = banDurationDays(reason, input.durationDays);
    const now = new Date();
    const bannedUntil = days == null ? null : new Date(now.getTime() + days * 86_400_000);
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: target.id }, data: { deletedAt: now, banReason: reason, banComment: input.comment.trim().slice(0, 1000), bannedAt: now, bannedUntil, sessionVersion: { increment: 1 } } });
      await tx.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now, revokeReason: 'ADMIN' } });
      await tx.adminActionLog.create({ data: { adminUserId: actor.id, action: 'ADMIN_USER_BAN', targetType: 'User', targetId: target.id.toString(), metadataJson: { onixId: formatOnixId(target.onixId), reason, reasonLabel: BAN_REASON_LABELS[reason], comment: input.comment.trim().slice(0, 1000), bannedUntil: bannedUntil?.toISOString() ?? null } } });
      return updated;
    });
    return { onixId: formatOnixId(user.onixId), banned: true, bannedUntil: user.bannedUntil?.toISOString() ?? null };
  }

  async sellBanUser(actor: AdminActor, targetId: string, input: { comment: string; banned: boolean }) {
    const target = await this.resolveTarget(targetId);
    if (input.banned && !input.comment?.trim()) throw new BadRequestException('??????? ??????? ??????? ??????.');
    const now = input.banned ? new Date() : null;
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: target.id }, data: { sellBannedAt: now } });
      let archived = 0;
      if (input.banned) {
        const changed = await tx.product.updateMany({ where: { sellerId: target.id, status: 'ACTIVE' }, data: { status: 'ARCHIVED' } });
        archived = changed.count;
      }
      await tx.adminActionLog.create({ data: { adminUserId: actor.id, action: input.banned ? 'ADMIN_USER_SELL_BAN' : 'ADMIN_USER_SELL_UNBAN', targetType: 'User', targetId: target.id.toString(), metadataJson: { onixId: formatOnixId(target.onixId), comment: input.comment?.trim().slice(0, 1000) ?? null, archived } } });
      return updated;
    });
    return { onixId: formatOnixId(result.onixId), sellBanned: Boolean(result.sellBannedAt) };
  }

  async setUserRole(actor: AdminActor, targetId: string, role: string) {
    if (actor.role !== 'SUPER_ADMIN') throw new ForbiddenException('?????? ?????????? ????? ????????? ????.');
    const allowed = ['USER', 'VERIFIED_SELLER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN', 'VIP'];
    if (!allowed.includes(role)) throw new BadRequestException('???????????? ????.');
    const target = await this.resolveTarget(targetId);
    if (target.id === actor.id && role !== 'SUPER_ADMIN') throw new BadRequestException('?????? ????? ???? ?????????? ? ???????? ????????.');
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const isSupport = isAdmin || role === 'MODERATOR';
    const updated = await this.prisma.user.update({ where: { id: target.id }, data: { platformStatus: role as any, isAdmin, isSupport, permissionVersion: { increment: 1 } } });
    await this.prisma.adminActionLog.create({ data: { adminUserId: actor.id, action: 'ADMIN_USER_ROLE_CHANGED', targetType: 'User', targetId: target.id.toString(), metadataJson: { onixId: formatOnixId(target.onixId), from: target.platformStatus, to: role } } });
    return { onixId: formatOnixId(updated.onixId), role: updated.platformStatus };
  }

  async adjustUserBalance(actor: AdminActor, targetId: string, input: { amountCents: string; reason: string; idempotencyKey: string }) {
    if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'FINANCE_ADMIN') throw new ForbiddenException('???????????? ???? ??? ????????? ???????.');
    const target = await this.resolveTarget(targetId);
    const amount = BigInt(input.amountCents);
    if (amount === 0n) throw new BadRequestException('????? ?? ????? ???? ????? ????.');
    const entry = await this.prisma.$transaction(async (tx) => {
      const meta = { idempotencyKey: input.idempotencyKey, description: input.reason?.trim().slice(0, 500), actorUserId: target.id, source: 'ADMIN' as const, fundKind: 'USER_OWNED' as const };
      const ledger = amount > 0n ? await this.balance.credit(tx, target.id, amount, 'ADMIN_ADJUSTMENT', meta) : await this.balance.debit(tx, target.id, -amount, 'ADMIN_ADJUSTMENT', { ...meta, allowNegative: true });
      await tx.adminActionLog.create({ data: { adminUserId: actor.id, action: 'ADMIN_BALANCE_ADJUST', targetType: 'User', targetId: target.id.toString(), metadataJson: { onixId: formatOnixId(target.onixId), amountCents: input.amountCents, reason: input.reason?.trim().slice(0, 500) } } });
      return ledger;
    });
    return { ledgerId: entry.id.toString(), amountCents: entry.amountCents.toString() };
  }

  async setUserStatus(actor: AdminActor, targetId: string, status: string) {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Изменять статус платформы может только SUPER_ADMIN.');
    }
    if (!isPlatformStatus(status)) throw new BadRequestException('Некорректный статус.');
    const target = await this.resolveTarget(targetId);
    if (!ALLOWED_PLATFORM_STATUS_TRANSITIONS[target.platformStatus].has(status)) {
      throw new BadRequestException(`Переход ${target.platformStatus} → ${status} не разрешён.`);
    }
    const flags = flagsFromPlatformStatus(status as PlatformStatus);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: target.id },
        data: {
          platformStatus: status as PlatformStatus,
          ...flags,
          permissionVersion: { increment: 1 },
        },
      });
      await tx.adminActionLog.create({
        data: {
          adminUserId: actor.id,
          action: 'ADMIN_USER_STATUS_CHANGED',
          targetType: 'User',
          targetId: target.id.toString(),
          metadataJson: {
            onixId: formatOnixId(target.onixId),
            from: target.platformStatus,
            to: status,
          },
        },
      });
      return row;
    });
    return {
      onixId: formatOnixId(updated.onixId),
      status: updated.platformStatus,
      isAdmin: updated.isAdmin,
      isSupport: updated.isSupport,
    };
  }

  async listSupportQueue() {
    const [tickets, disputes] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, chatId: true, createdAt: true,
          order: {
            select: {
              id: true, status: true, totalAmountCents: true, disputeReason: true,
              product: { select: { title: true } },
              buyer: { select: { onixId: true, displayName: true } },
              seller: { select: { onixId: true, displayName: true } },
            },
          },
        },
      }),
      this.prisma.order.findMany({
        where: { status: 'DISPUTE', supportTickets: { none: { status: 'OPEN' } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, status: true, totalAmountCents: true, disputeReason: true, createdAt: true,
          chatId: true, product: { select: { title: true } },
          buyer: { select: { onixId: true, displayName: true } },
          seller: { select: { onixId: true, displayName: true } },
        },
      }),
    ]);
    const party = (user: { onixId: string; displayName: string | null }) => ({
      onixId: formatOnixId(user.onixId),
      username: user.displayName ?? formatOnixId(user.onixId),
    });
    return [
      ...tickets.map((ticket) => ({
        ticketId: ticket.id,
        orderId: ticket.order.id.toString(),
        chatId: ticket.chatId,
        kind: ticket.order.status === 'DISPUTE' ? 'DISPUTE' : 'SUPPORT',
        status: ticket.order.status,
        productTitle: ticket.order.product.title,
        totalAmountCents: ticket.order.totalAmountCents.toString(),
        reason: ticket.order.disputeReason,
        buyer: party(ticket.order.buyer),
        seller: party(ticket.order.seller),
        createdAt: ticket.createdAt.toISOString(),
      })),
      ...disputes.map((order) => ({
        ticketId: null,
        orderId: order.id.toString(),
        chatId: order.chatId,
        kind: 'DISPUTE',
        status: order.status,
        productTitle: order.product.title,
        totalAmountCents: order.totalAmountCents.toString(),
        reason: order.disputeReason,
        buyer: party(order.buyer),
        seller: party(order.seller),
        createdAt: order.createdAt.toISOString(),
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async closeSupportTicket(actor: AdminActor, ticketId: string, reason?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Обращение не найдено.');
    if (ticket.status === 'CLOSED') return { ticketId, closed: true as const };
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      await tx.message.create({
        data: {
          chatId: ticket.chatId,
          kind: 'SYSTEM',
          senderId: null,
          text: reason?.trim()
            ? `Обращение закрыто поддержкой.\n${reason.trim().slice(0, 1000)}`
            : 'Обращение закрыто поддержкой.',
        },
      });
      await tx.adminActionLog.create({
        data: {
          adminUserId: actor.id,
          action: 'ADMIN_SUPPORT_TICKET_CLOSE',
          targetType: 'SupportTicket',
          targetId: ticketId,
          metadataJson: reason?.trim() ? { reason: reason.trim().slice(0, 500) } : undefined,
        },
      });
    });
    return { ticketId, closed: true as const };
  }

  async listReports() {
    const rows = await this.prisma.userReport.findMany({
      where: { closedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, kind: true, reason: true, comment: true, createdAt: true, reviewId: true,
        reporter: { select: { onixId: true, displayName: true } },
        target: { select: { onixId: true, displayName: true } },
      },
    });
    return rows.map((row) => ({
      ...row,
      reviewId: row.reviewId?.toString() ?? null,
      createdAt: row.createdAt.toISOString(),
      reporter: { onixId: formatOnixId(row.reporter.onixId), username: row.reporter.displayName },
      target: { onixId: formatOnixId(row.target.onixId), username: row.target.displayName },
    }));
  }

  async upholdReviewAppeal(actor: AdminActor, reportId: string) {
    const report = await this.prisma.userReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Жалоба не найдена.');
    if (report.kind !== 'REVIEW_APPEAL' || !report.reviewId) {
      throw new BadRequestException('Это не обжалование отзыва.');
    }
    if (report.closedAt) throw new BadRequestException('Обращение уже закрыто.');
    const reviewId = report.reviewId;
    await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({ where: { id: reviewId } });
      if (review && !review.hiddenAt) {
        await tx.review.update({
          where: { id: review.id },
          data: { hiddenAt: new Date(), hiddenReason: 'APPEAL' },
        });
        await recomputeSellerRating(tx as never, review.subjectId, { floorPrevious: true });
      }
      await tx.userReport.update({
        where: { id: reportId },
        data: { closedAt: new Date(), adminReply: 'Обжалование подтверждено, отзыв скрыт.' },
      });
      await tx.adminActionLog.create({
        data: {
          adminUserId: actor.id,
          action: 'ADMIN_REVIEW_APPEAL_UPHOLD',
          targetType: 'UserReport',
          targetId: reportId,
          metadataJson: { reviewId: reviewId.toString() },
        },
      });
    });
    return { id: reportId, upheld: true as const, closed: true as const };
  }

  async closeReport(actor: AdminActor, reportId: string, reason?: string) {
    const report = await this.prisma.userReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Жалоба не найдена.');
    if (!report.closedAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.userReport.update({ where: { id: reportId }, data: { closedAt: new Date() } });
        await tx.adminActionLog.create({
          data: {
            adminUserId: actor.id,
            action: 'ADMIN_REPORT_CLOSE',
            targetType: 'UserReport',
            targetId: reportId,
            metadataJson: reason?.trim() ? { reason: reason.trim().slice(0, 500) } : undefined,
          },
        });
      });
    }
    return { id: reportId, closed: true as const };
  }

  async replyReport(actor: AdminActor, reportId: string, text: string) {
    const reply = text.trim().slice(0, 2000);
    if (!reply) throw new BadRequestException('Введите текст ответа.');
    const report = await this.prisma.userReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Жалоба не найдена.');
    if (report.kind !== 'AI_SUPPORT') throw new BadRequestException('Ответ доступен только для AI_SUPPORT.');
    if (report.closedAt) throw new BadRequestException('Обращение уже закрыто.');
    const note = await this.prisma.$transaction(async (tx) => {
      const created = await createDomainNotification(tx, {
        userId: report.reporterId,
        type: 'SYSTEM',
        title: 'Ответ поддержки ONIX',
        body: reply,
        data: { reportId: report.id },
      });
      await tx.userReport.update({
        where: { id: reportId },
        data: { adminReply: reply, repliedAt: new Date(), closedAt: new Date() },
      });
      await tx.adminActionLog.create({
        data: {
          adminUserId: actor.id,
          action: 'ADMIN_REPORT_REPLY',
          targetType: 'UserReport',
          targetId: reportId,
        },
      });
      return created;
    });
    deliverTelegramAfterCommit(this.prisma, [note.id]);
    return { id: reportId, replied: true as const, closed: true as const };
  }

  private async legacyEscrowActor(actor: AdminActor): Promise<AuthUser> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: actor.id },
      select: { telegramId: true },
    });
    if (!admin?.telegramId) {
      throw new BadRequestException('Для Escrow-действия привяжите Telegram ID к admin-профилю.');
    }
    const user = await this.prisma.user.findUnique({
      where: { telegramId: admin.telegramId },
      select: { id: true, telegramId: true, onixId: true, platformStatus: true },
    });
    if (!user) throw new BadRequestException('Для Escrow-действия нужен связанный пользователь платформы.');
    return { ...user, isAdmin: true, isSupport: true };
  }

  private async createEscrowAuditIntent(
    actor: AdminActor,
    action: 'ADMIN_ORDER_REFUND' | 'ADMIN_ORDER_COMPLETE',
    orderId: string,
    reason?: string,
  ) {
    return this.prisma.adminActionLog.create({
      data: {
        adminUserId: actor.id,
        action: `${action}_PENDING`,
        targetType: 'Order',
        targetId: orderId,
        metadataJson: {
          state: 'PENDING',
          reason: reason?.trim().slice(0, 500) ?? null,
        },
      },
      select: { id: true },
    });
  }

  private async finishEscrowAudit(
    auditId: bigint,
    action: 'ADMIN_ORDER_REFUND' | 'ADMIN_ORDER_COMPLETE',
    state: 'COMPLETED' | 'FAILED',
    reason?: string,
    error?: unknown,
  ): Promise<void> {
    await this.prisma.adminActionLog.update({
      where: { id: auditId },
      data: {
        action,
        metadataJson: {
          state,
          reason: reason?.trim().slice(0, 500) ?? null,
          ...(state === 'FAILED'
            ? { error: error instanceof Error ? error.message.slice(0, 500) : 'Escrow mutation failed' }
            : {}),
        },
      },
    });
  }

  async refundOrder(actor: AdminActor, orderId: string, reason?: string) {
    if (!/^\d+$/.test(orderId)) throw new BadRequestException('Некорректный id сделки.');
    const escrowActor = await this.legacyEscrowActor(actor);
    const audit = await this.createEscrowAuditIntent(actor, 'ADMIN_ORDER_REFUND', orderId, reason);
    try {
      const result = await this.escrow.refundByAdmin(escrowActor, BigInt(orderId), reason);
      await this.finishEscrowAudit(audit.id, 'ADMIN_ORDER_REFUND', 'COMPLETED', reason)
        .catch(() => undefined);
      return result;
    } catch (error) {
      await this.finishEscrowAudit(audit.id, 'ADMIN_ORDER_REFUND', 'FAILED', reason, error)
        .catch(() => undefined);
      throw error;
    }
  }

  async completeOrder(actor: AdminActor, orderId: string, reason?: string) {
    if (!/^\d+$/.test(orderId)) throw new BadRequestException('Некорректный id сделки.');
    const escrowActor = await this.legacyEscrowActor(actor);
    const audit = await this.createEscrowAuditIntent(actor, 'ADMIN_ORDER_COMPLETE', orderId, reason);
    try {
      const result = await this.escrow.completeByAdmin(escrowActor, BigInt(orderId), reason);
      await this.finishEscrowAudit(audit.id, 'ADMIN_ORDER_COMPLETE', 'COMPLETED', reason)
        .catch(() => undefined);
      return result;
    } catch (error) {
      await this.finishEscrowAudit(audit.id, 'ADMIN_ORDER_COMPLETE', 'FAILED', reason, error)
        .catch(() => undefined);
      throw error;
    }
  }

  async listProducts(opts?: { limit?: number; status?: string }) {
    const take = Math.min(Math.max(opts?.limit ?? 100, 1), 200);
    const allowed = ['ACTIVE', 'ARCHIVED', 'RESERVED', 'SOLD_OUT'];
    const status = opts?.status && allowed.includes(opts.status) ? opts.status as any : undefined;
    const rows = await this.prisma.product.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, lotNumber: true, title: true, status: true, priceCents: true,
        quantity: true, createdAt: true,
        seller: { select: { onixId: true, displayName: true } },
      },
    });
    return rows.map((row) => ({
      ...row,
      priceCents: row.priceCents.toString(),
      createdAt: row.createdAt.toISOString(),
      seller: { ...row.seller, onixId: formatOnixId(row.seller.onixId) },
    }));
  }

  async moderateProduct(actor: AdminActor, productId: string, reason?: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Товар не найден.');
    if (product.status === 'RESERVED') throw new BadRequestException('Товар участвует в сделке.');
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data: { status: 'ARCHIVED' } });
      await tx.favorite.deleteMany({ where: { productId } });
      await tx.adminActionLog.create({
        data: {
          adminUserId: actor.id,
          action: 'ADMIN_PRODUCT_ARCHIVE',
          targetType: 'Product',
          targetId: productId,
          metadataJson: { sellerId: product.sellerId.toString(), title: product.title, reason: reason?.trim().slice(0, 500) ?? null },
        },
      });
    });
    return { id: productId, status: 'ARCHIVED' as const };
  }

  async listMessages(opts?: { limit?: number; search?: string }) {
    const take = Math.min(Math.max(opts?.limit ?? 100, 1), 200);
    const rows = await this.prisma.message.findMany({
      where: opts?.search?.trim() ? { text: { contains: opts.search.trim(), mode: 'insensitive' } } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, chatId: true, senderId: true, kind: true, text: true,
        deletedAt: true, deletedReason: true, createdAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      id: row.id.toString(),
      senderId: row.senderId?.toString() ?? null,
      createdAt: row.createdAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    }));
  }

  async moderateMessage(actor: AdminActor, messageId: string, reason?: string) {
    if (!/^\d+$/.test(messageId)) throw new BadRequestException('Некорректный id сообщения.');
    const id = BigInt(messageId);
    const message = await this.prisma.message.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('Сообщение не найдено.');
    if (!message.deletedAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.message.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            deletedForAll: true,
            deletedReason: reason?.trim().slice(0, 500) || 'Удалено администратором',
          },
        });
        await tx.adminActionLog.create({
          data: {
            adminUserId: actor.id,
            action: 'ADMIN_MESSAGE_DELETE',
            targetType: 'Message',
            targetId: messageId,
            metadataJson: { chatId: message.chatId, reason: reason?.trim().slice(0, 500) ?? null },
          },
        });
      });
    }
    return { id: messageId, deleted: true as const };
  }

  async listOrders(opts?: { limit?: number; status?: string }) {
    const take = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const status = opts?.status && ['PENDING', 'PAYMENT_HOLD', 'DELIVERING', 'DISPUTE', 'COMPLETED', 'CANCELED', 'REFUNDED'].includes(opts.status)
      ? opts.status as Prisma.OrderWhereInput['status']
      : undefined;
    const rows = await this.prisma.order.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, status: true, totalAmountCents: true, feeCents: true, payoutCents: true,
        quantity: true, disputeReason: true, createdAt: true, updatedAt: true,
        buyer: { select: { onixId: true, telegramId: true, displayName: true } },
        seller: { select: { onixId: true, telegramId: true, displayName: true } },
        product: { select: { id: true, title: true, status: true } },
        transitions: { orderBy: { createdAt: 'desc' }, take: 1, select: { from: true, to: true, actorId: true, reason: true, createdAt: true } },
      },
    });
    return rows.map((row) => ({
      ...row,
      id: row.id.toString(),
      totalAmountCents: row.totalAmountCents.toString(),
      feeCents: row.feeCents.toString(),
      payoutCents: row.payoutCents.toString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      buyer: { ...row.buyer, telegramId: row.buyer.telegramId?.toString() ?? null, onixId: formatOnixId(row.buyer.onixId) },
      seller: { ...row.seller, telegramId: row.seller.telegramId?.toString() ?? null, onixId: formatOnixId(row.seller.onixId) },
      transitions: row.transitions.map((t) => ({ ...t, actorId: t.actorId?.toString() ?? null, createdAt: t.createdAt.toISOString() })),
    }));
  }

  async getOrderInvestigation(id: string) {
    const orderId = /^\d+$/.test(id) ? BigInt(id) : null;
    if (!orderId) return null;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        buyer: { select: { id: true, onixId: true, telegramId: true, displayName: true } },
        seller: { select: { id: true, onixId: true, telegramId: true, displayName: true } },
        product: { select: { id: true, title: true, description: true, status: true, priceCents: true, quantity: true } },
        transitions: { orderBy: { createdAt: 'asc' } },
        supportTickets: { orderBy: { createdAt: 'asc' }, select: { id: true, status: true, openedById: true, createdAt: true, closedAt: true } },
        chat: { select: { id: true, messages: { orderBy: { createdAt: 'asc' }, take: 500, select: { id: true, senderId: true, kind: true, text: true, deletedAt: true, createdAt: true } } } },
      },
    });
    if (!order) return null;
    return {
      ...order,
      id: order.id.toString(), productId: order.productId.toString(), buyerId: order.buyerId.toString(), sellerId: order.sellerId.toString(),
      totalAmountCents: order.totalAmountCents.toString(), feeCents: order.feeCents.toString(), payoutCents: order.payoutCents.toString(),
      createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString(), canceledAt: order.canceledAt?.toISOString() ?? null, completedAt: order.completedAt?.toISOString() ?? null,
      buyer: { ...order.buyer, id: order.buyer.id.toString(), telegramId: order.buyer.telegramId?.toString() ?? null, onixId: formatOnixId(order.buyer.onixId) },
      seller: { ...order.seller, id: order.seller.id.toString(), telegramId: order.seller.telegramId?.toString() ?? null, onixId: formatOnixId(order.seller.onixId) },
      product: { ...order.product, priceCents: order.product.priceCents.toString() },
      transitions: order.transitions.map((t) => ({ ...t, id: t.id.toString(), orderId: t.orderId.toString(), actorId: t.actorId?.toString() ?? null, createdAt: t.createdAt.toISOString() })),
      supportTickets: order.supportTickets.map((t) => ({ ...t, openedById: t.openedById.toString(), createdAt: t.createdAt.toISOString(), closedAt: t.closedAt?.toISOString() ?? null })),
      chat: order.chat ? { id: order.chat.id, messages: order.chat.messages.map((m) => ({ ...m, id: m.id.toString(), senderId: m.senderId?.toString() ?? null, createdAt: m.createdAt.toISOString(), deletedAt: m.deletedAt?.toISOString() ?? null })) } : null,
    };
  }

  async listAdminAudit(opts?: { limit?: number; action?: string }) {
    const take = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    const rows = await this.prisma.adminActionLog.findMany({
      where: opts?.action ? { action: opts.action.slice(0, 64) } : undefined,
      orderBy: { createdAt: 'desc' }, take,
      include: { adminUser: { select: { email: true, role: true } } },
    });
    return rows.map((row) => ({ ...row, id: row.id.toString(), adminUserId: row.adminUserId.toString(), createdAt: row.createdAt.toISOString() }));
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
        payload: true,
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