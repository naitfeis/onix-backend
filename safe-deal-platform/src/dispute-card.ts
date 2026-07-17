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

function supportLabelFromOnix(onixId: string | null | undefined): string {
  if (!onixId) return 'ONIX Support';
  const digits = onixId.replace(/\D/g, '').replace(/^0+/, '') || '0';
  return `ONIX Support #${digits}`;
}

/** Open arbitration queue + average resolution time for buyer/seller dispute cards. */
export async function loadArbitrationContext(prisma: PrismaClient): Promise<{
  queue: QueueRow[];
  queueTotal: number;
  positionByOrderId: Map<string, number>;
  avgWaitMinutes: number | null;
  supportByChatId: Map<string, string>;
}> {
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

export function buildDisputeCard(opts: {
  orderId: bigint;
  status: string;
  chatId?: string | null;
  ticket?: { id: string; status: string; chatId: string } | null;
  ctx: Awaited<ReturnType<typeof loadArbitrationContext>>;
}): DisputeCardDto | null {
  const { orderId, status, chatId, ticket, ctx } = opts;
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

  const id = orderId.toString();
  const reviewing = open && !resolved;
  const chat = ticket?.chatId || chatId || null;

  return {
    orderId: id,
    status: reviewing ? 'REVIEWING' : 'RESOLVED',
    statusLabel: reviewing ? 'Изучение доказательств' : 'Решено',
    supportLabel: (chat && ctx.supportByChatId.get(chat)) || 'ONIX Support',
    queuePosition: reviewing ? (ctx.positionByOrderId.get(id) ?? null) : null,
    queueTotal: ctx.queueTotal,
    avgWaitMinutes: ctx.avgWaitMinutes,
  };
}
