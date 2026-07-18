import type { PrismaClient } from '@prisma/client';
import { formatOnixId } from './onix-id';

export type DisputeCardDto = {
  orderId: string;
  status: 'REVIEWING' | 'RESOLVED';
  statusLabel: string;
  supportLabel: string;
  queuePosition: number | null;
  queueTotal: number;
  avgWaitMinutes: number | null;
};

type QueueRow = { orderId: bigint; at: Date; chatId: string | null };

type ArbitrationContext = {
  queue: QueueRow[];
  queueTotal: number;
  positionByOrderId: Map<string, number>;
  avgWaitMinutes: number | null;
  supportByChatId: Map<string, string>;
};

const EMPTY_CTX: ArbitrationContext = {
  queue: [],
  queueTotal: 0,
  positionByOrderId: new Map(),
  avgWaitMinutes: null,
  supportByChatId: new Map(),
};

const ARB_CACHE_TTL_MS = 30_000;
let arbCache: { at: number; value: ArbitrationContext } | null = null;

function supportLabelFromOnix(onixId: string | null | undefined): string {
  if (!onixId) return 'ONIX Support';
  const digits = onixId.replace(/\D/g, '').replace(/^0+/, '') || '0';
  return `ONIX Support #${digits}`;
}

function disputePhase(opts: {
  status: string;
  ticket?: { id: string; status: string; chatId: string } | null;
}): { reviewing: boolean; resolved: boolean } | null {
  const { status, ticket } = opts;
  const hasTicket = Boolean(ticket);
  const inDispute = status === 'DISPUTE';
  if (!hasTicket && !inDispute) return null;

  const open = (ticket?.status === 'OPEN') || (inDispute && (!ticket || ticket.status === 'OPEN'));
  const resolved = !open && (
    ticket?.status === 'CLOSED'
    || status === 'COMPLETED'
    || status === 'REFUNDED'
    || status === 'CANCELED'
  );
  if (!open && !resolved && !hasTicket) return null;
  return { reviewing: open && !resolved, resolved };
}

/** Open arbitration queue + average resolution time for buyer/seller dispute cards. */
export async function loadArbitrationContext(prisma: PrismaClient): Promise<ArbitrationContext> {
  const [openTickets, bareDisputes, closedSample] = await Promise.all([
    prisma.supportTicket.findMany({
      where: { status: 'OPEN' },
      select: { orderId: true, createdAt: true, chatId: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }),
    prisma.order.findMany({
      where: {
        status: 'DISPUTE',
        supportTickets: { none: {} },
      },
      select: { id: true, updatedAt: true, chatId: true },
      take: 500,
    }),
    prisma.supportTicket.findMany({
      where: { status: 'CLOSED', closedAt: { not: null } },
      select: { createdAt: true, closedAt: true },
      orderBy: { closedAt: 'desc' },
      take: 50,
    }),
  ]);

  const byOrder = new Map<string, QueueRow>();
  for (const t of openTickets) {
    const key = t.orderId.toString();
    if (!byOrder.has(key)) {
      byOrder.set(key, { orderId: t.orderId, at: t.createdAt, chatId: t.chatId });
    }
  }
  for (const o of bareDisputes) {
    const key = o.id.toString();
    if (!byOrder.has(key)) {
      byOrder.set(key, { orderId: o.id, at: o.updatedAt, chatId: o.chatId });
    }
  }

  const queue = [...byOrder.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
  const positionByOrderId = new Map<string, number>();
  queue.forEach((row, index) => positionByOrderId.set(row.orderId.toString(), index + 1));

  let avgWaitMinutes: number | null = null;
  if (closedSample.length > 0) {
    const mins = closedSample
      .filter((r) => r.closedAt)
      .map((r) => Math.max(1, Math.round((r.closedAt!.getTime() - r.createdAt.getTime()) / 60_000)));
    if (mins.length) {
      avgWaitMinutes = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    }
  }

  const chatIds = [...new Set(queue.map((q) => q.chatId).filter((id): id is string => Boolean(id)))];
  const supportByChatId = new Map<string, string>();
  if (chatIds.length) {
    const staffMembers = await prisma.chatMember.findMany({
      where: {
        chatId: { in: chatIds },
        user: { OR: [{ isSupport: true }, { isAdmin: true }], deletedAt: null },
      },
      select: {
        chatId: true,
        user: { select: { onixId: true, isAdmin: true, isSupport: true } },
      },
      take: 1000,
    });
    for (const m of staffMembers) {
      if (supportByChatId.has(m.chatId)) continue;
      supportByChatId.set(m.chatId, supportLabelFromOnix(formatOnixId(m.user.onixId)));
    }
  }

  return {
    queue,
    queueTotal: queue.length,
    positionByOrderId,
    avgWaitMinutes,
    supportByChatId,
  };
}

/** Cached queue/context — for single-order / admin paths, not for GET /orders list. */
export async function loadArbitrationContextCached(prisma: PrismaClient): Promise<ArbitrationContext> {
  const now = Date.now();
  if (arbCache && now - arbCache.at < ARB_CACHE_TTL_MS) {
    return arbCache.value;
  }
  const value = await loadArbitrationContext(prisma);
  arbCache = { at: now, value };
  return value;
}

export function invalidateArbitrationContextCache(): void {
  arbCache = null;
}

/**
 * List-safe dispute card — no global queue scan.
 * Queue position / avg wait stay null until a detail path loads cached context.
 */
export function buildLightDisputeCard(opts: {
  orderId: bigint;
  status: string;
  ticket?: { id: string; status: string; chatId: string } | null;
}): DisputeCardDto | null {
  const phase = disputePhase(opts);
  if (!phase) return null;
  return {
    orderId: opts.orderId.toString(),
    status: phase.reviewing ? 'REVIEWING' : 'RESOLVED',
    statusLabel: phase.reviewing ? 'Изучение доказательств' : 'Решено',
    supportLabel: 'ONIX Support',
    queuePosition: null,
    queueTotal: 0,
    avgWaitMinutes: null,
  };
}

export function buildDisputeCard(opts: {
  orderId: bigint;
  status: string;
  chatId?: string | null;
  ticket?: { id: string; status: string; chatId: string } | null;
  ctx?: ArbitrationContext;
}): DisputeCardDto | null {
  const phase = disputePhase(opts);
  if (!phase) return null;

  const ctx = opts.ctx ?? EMPTY_CTX;
  const id = opts.orderId.toString();
  const chat = opts.ticket?.chatId || opts.chatId || null;

  return {
    orderId: id,
    status: phase.reviewing ? 'REVIEWING' : 'RESOLVED',
    statusLabel: phase.reviewing ? 'Изучение доказательств' : 'Решено',
    supportLabel: (chat && ctx.supportByChatId.get(chat)) || 'ONIX Support',
    queuePosition: phase.reviewing ? (ctx.positionByOrderId.get(id) ?? null) : null,
    queueTotal: ctx.queueTotal,
    avgWaitMinutes: ctx.avgWaitMinutes,
  };
}
