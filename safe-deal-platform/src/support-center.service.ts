import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { assertOrderResolvedForTicketClose } from './support-ticket-guard';
import { formatTicketPublicId, SecurityLockService } from './risk/security-lock.service';
import type { AdminActor } from './admin/admin-session.service';
import { formatOnixId } from './onix-id';

const TICKET_STATUSES: SupportTicketStatus[] = ['OPEN', 'IN_REVIEW', 'WAITING_USER', 'RESOLVED', 'CLOSED'];

@Injectable()
export class SupportCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: SecurityLockService,
  ) {}

  async createTicket(input: {
    openedById?: bigint | null;
    reportedUserId?: bigint | null;
    category: SupportTicketCategory;
    priority?: SupportTicketPriority;
    subject?: string;
    body?: string;
    orderId?: bigint | null;
    chatId?: string | null;
    listingId?: string | null;
    securityEventId?: bigint | null;
    actorKind?: string;
  }) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        openedById: input.openedById ?? null,
        reportedUserId: input.reportedUserId ?? null,
        category: input.category,
        priority: input.priority ?? (input.category === 'RISK_ENGINE' || input.category === 'BAN_EVASION' ? 'HIGH' : 'MEDIUM'),
        subject: input.subject?.slice(0, 240) ?? null,
        body: input.body ?? null,
        orderId: input.orderId ?? null,
        chatId: input.chatId ?? null,
        relatedListingId: input.listingId ?? null,
        relatedSecurityEventId: input.securityEventId ?? null,
        status: 'OPEN',
      },
    });
    await this.prisma.supportTicketEvent.create({
      data: {
        ticketId: ticket.id,
        kind: input.actorKind ?? (input.openedById ? 'USER_CREATED' : 'SYSTEM_CREATED'),
        actorUserId: input.openedById ?? null,
        message: input.subject || input.category,
      },
    });
    return ticket;
  }

  async createAppeal(userId: bigint, explanation: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        securityLockedAt: true,
        securityCasePublicId: true,
        sellBannedAt: true,
        bannedAt: true,
      },
    });
    if (!user) throw new NotFoundException('Пользователь не найден.');
    const category: SupportTicketCategory = user.bannedAt
      ? 'BAN_APPEAL'
      : user.sellBannedAt && !user.securityLockedAt
        ? 'SELL_BAN_APPEAL'
        : 'BAN_APPEAL';
    const existing = await this.prisma.supportTicket.findFirst({
      where: {
        openedById: userId,
        category: { in: ['BAN_APPEAL', 'SELL_BAN_APPEAL'] },
        status: { in: ['OPEN', 'IN_REVIEW', 'WAITING_USER'] },
      },
    });
    if (existing) {
      await this.prisma.supportTicketEvent.create({
        data: {
          ticketId: existing.id,
          kind: 'USER_REPLIED',
          actorUserId: userId,
          message: explanation.trim().slice(0, 1000),
        },
      });
      await this.prisma.supportTicket.update({
        where: { id: existing.id },
        data: { status: 'IN_REVIEW', body: explanation.trim() },
      });
      return {
        ticketId: existing.id,
        publicId: formatTicketPublicId(existing.publicNumber),
        caseId: user.securityCasePublicId,
        status: 'IN_REVIEW' as const,
      };
    }
    const ticket = await this.createTicket({
      openedById: userId,
      reportedUserId: userId,
      category,
      priority: 'HIGH',
      subject: user.securityCasePublicId
        ? `Апелляция ${user.securityCasePublicId}`
        : 'Апелляция на ограничение',
      body: explanation.trim(),
      actorKind: 'USER_CREATED',
    });
    return {
      ticketId: ticket.id,
      publicId: formatTicketPublicId(ticket.publicNumber),
      caseId: user.securityCasePublicId,
      status: ticket.status,
    };
  }

  async listTickets(opts: {
    status?: string;
    category?: string;
    limit?: number;
  }) {
    const take = Math.min(Math.max(opts.limit ?? 80, 1), 200);
    const status = opts.status && TICKET_STATUSES.includes(opts.status as SupportTicketStatus)
      ? opts.status as SupportTicketStatus
      : undefined;
    const category = opts.category && opts.category !== 'ALL'
      ? opts.category as SupportTicketCategory
      : undefined;
    const rows = await this.prisma.supportTicket.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take,
      include: {
        openedBy: { select: { onixId: true, displayName: true } },
        reportedUser: { select: { onixId: true, displayName: true, securityCasePublicId: true, securityLockLevel: true } },
        order: { select: { id: true, status: true } },
      },
    });
    return rows.map((row) => serializeTicketListItem(row));
  }

  async listMine(userId: bigint) {
    const rows = await this.prisma.supportTicket.findMany({
      where: { openedById: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        openedBy: { select: { onixId: true, displayName: true } },
        reportedUser: { select: { onixId: true, displayName: true, securityCasePublicId: true, securityLockLevel: true } },
        order: { select: { id: true, status: true } },
      },
    });
    return { tickets: rows.map((row) => serializeTicketListItem(row)) };
  }

  async getTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        openedBy: { select: { id: true, onixId: true, displayName: true, telegramNick: true } },
        reportedUser: {
          select: {
            id: true, onixId: true, displayName: true, telegramNick: true,
            securityLockedAt: true, securityLockLevel: true, securityCasePublicId: true,
            sellBannedAt: true, withdrawBlockedAt: true, suspiciousFundsHoldAt: true,
          },
        },
        order: { select: { id: true, status: true, product: { select: { id: true, title: true } } } },
        events: { orderBy: { createdAt: 'asc' }, take: 80 },
      },
    });
    if (!ticket) throw new NotFoundException('Тикет не найден.');

    const userId = ticket.reportedUserId ?? ticket.openedById;
    const [riskEvents, ledger, identities, sessions] = userId
      ? await Promise.all([
        this.prisma.securityEvent.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.ledgerEntry.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: { id: true, type: true, amountCents: true, fundKind: true, saleKind: true, createdAt: true },
        }),
        this.prisma.identityLink.findMany({
          where: { userId, deletedAt: null },
          select: { provider: true, providerUserId: true, username: true, linkedAt: true },
        }),
        this.prisma.session.findMany({
          where: { userId },
          orderBy: { lastSeenAt: 'desc' },
          take: 8,
          select: {
            id: true, fingerprintHash: true, ipAddress: true, country: true,
            revokedAt: true, lastSeenAt: true, userAgent: true,
          },
        }),
      ])
      : [[], [], [], []];

    return {
      ...serializeTicketListItem(ticket),
      body: ticket.body,
      related: {
        order: ticket.order
          ? { id: ticket.order.id.toString(), status: ticket.order.status, listingId: ticket.order.product?.id, listingTitle: ticket.order.product?.title }
          : null,
        listingId: ticket.relatedListingId,
        chatId: ticket.chatId,
        riskEvents: riskEvents.map((e) => ({
          id: e.id.toString(),
          type: e.type,
          severity: e.severity,
          status: e.status,
          createdAt: e.createdAt.toISOString(),
          payload: e.payload,
        })),
        identities: identities.map((i) => ({
          provider: i.provider,
          username: i.username,
          linkedAt: i.linkedAt.toISOString(),
        })),
        sessions: sessions.map((s) => ({
          id: s.id,
          ipAddress: s.ipAddress,
          country: s.country,
          device: s.fingerprintHash ? s.fingerprintHash.slice(0, 8) : null,
          revoked: Boolean(s.revokedAt),
          lastSeenAt: s.lastSeenAt.toISOString(),
        })),
        ledger: ledger.map((l) => ({
          id: l.id.toString(),
          type: l.type,
          amountCents: l.amountCents.toString(),
          fundKind: l.fundKind,
          saleKind: l.saleKind,
          createdAt: l.createdAt.toISOString(),
        })),
      },
      timeline: ticket.events.map((e) => ({
        id: e.id,
        kind: e.kind,
        message: e.message,
        at: e.createdAt.toISOString(),
        actorAdminId: e.actorAdminId?.toString() ?? null,
        actorUserId: e.actorUserId?.toString() ?? null,
      })),
    };
  }

  async setStatus(actor: AdminActor, ticketId: string, status: SupportTicketStatus, comment?: string) {
    if (!TICKET_STATUSES.includes(status)) throw new BadRequestException('Неизвестный статус.');
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Тикет не найден.');
    if (status === 'CLOSED' || status === 'RESOLVED') {
      await assertOrderResolvedForTicketClose(this.prisma, ticket.orderId);
    }
    await this.prisma.$transaction(async (tx) => {
      if (status === 'CLOSED' || status === 'RESOLVED') {
        await assertOrderResolvedForTicketClose(tx, ticket.orderId);
      }
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status,
          closedAt: status === 'CLOSED' || status === 'RESOLVED' ? new Date() : ticket.closedAt,
        },
      });
      await tx.supportTicketEvent.create({
        data: {
          ticketId,
          kind: 'ADMIN_STATUS',
          actorAdminId: actor.id,
          message: comment?.trim()
            ? `${ticket.status} → ${status}: ${comment.trim().slice(0, 800)}`
            : `${ticket.status} → ${status}`,
        },
      });
      await tx.adminActionLog.create({
        data: {
          adminUserId: actor.id,
          action: 'ADMIN_TICKET_STATUS',
          targetType: 'SupportTicket',
          targetId: ticketId,
          metadataJson: { from: ticket.status, to: status },
        },
      });
    });
    return { ticketId, status };
  }

  async addComment(actor: AdminActor, ticketId: string, text: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Тикет не найден.');
    const message = text.trim().slice(0, 1000);
    if (!message) throw new BadRequestException('Комментарий пуст.');
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicketEvent.create({
        data: {
          ticketId,
          kind: 'ADMIN_COMMENT',
          actorAdminId: actor.id,
          message,
        },
      });
      await tx.adminActionLog.create({
        data: {
          adminUserId: actor.id,
          action: 'ADMIN_TICKET_COMMENT',
          targetType: 'SupportTicket',
          targetId: ticketId,
        },
      });
    });
    return { ticketId, ok: true as const };
  }

  async decideLock(
    actor: AdminActor,
    ticketId: string,
    decision: 'KEEP_LOCK' | 'UNLOCK' | 'REDUCE_RESTRICTIONS' | 'PERMANENT_BAN',
    reason?: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Тикет не найден.');
    const userId = ticket.reportedUserId ?? ticket.openedById;
    if (!userId) throw new BadRequestException('У тикета нет целевого пользователя.');
    return this.locks.applyDecision({
      userId,
      decision,
      adminUserId: actor.id,
      reason,
      ticketId,
    });
  }
}

function serializeTicketListItem(row: {
  id: string;
  publicNumber: number;
  status: SupportTicketStatus;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  subject: string | null;
  createdAt: Date;
  chatId: string | null;
  orderId: bigint | null;
  openedBy: { onixId: string; displayName: string | null } | null;
  reportedUser: { onixId: string; displayName: string | null; securityCasePublicId?: string | null; securityLockLevel?: string | null } | null;
}) {
  return {
    id: row.id,
    publicId: formatTicketPublicId(row.publicNumber),
    status: row.status,
    category: row.category,
    priority: row.priority,
    subject: row.subject,
    createdAt: row.createdAt.toISOString(),
    chatId: row.chatId,
    orderId: row.orderId?.toString() ?? null,
    reporter: row.openedBy
      ? { onixId: formatOnixId(row.openedBy.onixId), username: row.openedBy.displayName }
      : null,
    reportedUser: row.reportedUser
      ? {
        onixId: formatOnixId(row.reportedUser.onixId),
        username: row.reportedUser.displayName,
        caseId: row.reportedUser.securityCasePublicId ?? null,
        lockLevel: row.reportedUser.securityLockLevel ?? null,
      }
      : null,
  };
}

export type { Prisma };
