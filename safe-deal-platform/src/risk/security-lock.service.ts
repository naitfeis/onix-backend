import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Prisma, SupportTicketCategory, SupportTicketPriority } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { createDomainNotification, deliverTelegramAfterCommit, pushTelegramToChatId } from '../domain-notify';
import { AuthPlatformError } from '../auth-v2/auth-errors';

export type SecurityLockLevel = 'HIGH' | 'CRITICAL';

export type ApplyLockInput = {
  userId: bigint;
  level: SecurityLockLevel;
  eventType: string;
  reasons: string[];
  related?: {
    orderId?: bigint | null;
    listingId?: string | null;
    chatId?: string | null;
    securityEventId?: bigint | null;
    messageId?: bigint | null;
  };
};

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Automatic SECURITY LOCK — stops dangerous actions immediately.
 * Never deletes the account or destroys data. User can appeal.
 */
@Injectable()
export class SecurityLockService {
  private readonly logger = new Logger(SecurityLockService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isLocked(userId: bigint, db: Db = this.prisma): Promise<boolean> {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { securityLockedAt: true },
    });
    return Boolean(row?.securityLockedAt);
  }

  async assertNotLocked(
    userId: bigint,
    action: 'sell' | 'withdraw' | 'spend' | 'transfer',
    db: Db = this.prisma,
  ): Promise<void> {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: {
        securityLockedAt: true,
        securityCasePublicId: true,
        sellBannedAt: true,
        withdrawBlockedAt: true,
        suspiciousFundsHoldAt: true,
      },
    });
    if (!row) return;
    const blocked = Boolean(row.securityLockedAt)
      || (action === 'sell' && row.sellBannedAt)
      || (action === 'withdraw' && row.withdrawBlockedAt)
      || ((action === 'spend' || action === 'transfer') && (row.suspiciousFundsHoldAt || row.securityLockedAt));
    if (!blocked) return;
    throw new AuthPlatformError(
      'AUTH_SECURITY_LOCK',
      'Аккаунт временно ограничен из‑за подозрительной активности. Вы можете обжаловать решение в поддержке.',
      {
        caseId: row.securityCasePublicId,
        action,
        appeal: true,
      },
    );
  }

  async applyLock(input: ApplyLockInput): Promise<{
    locked: true;
    caseId: string;
    ticketId: string;
    ticketPublicNumber: number;
    reused: boolean;
  }> {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          onixId: true,
          telegramId: true,
          securityLockedAt: true,
          securityCasePublicId: true,
        },
      });
      if (!user) {
        throw new Error('user_missing');
      }

      const caseId = user.securityCasePublicId || `SEC-${numericOnix(user.onixId)}`;
      const reused = Boolean(user.securityLockedAt);
      const reason = input.reasons.slice(0, 6).join('; ').slice(0, 500) || input.eventType;

      await tx.user.update({
        where: { id: user.id },
        data: {
          securityLockedAt: user.securityLockedAt ?? now,
          securityLockLevel: input.level,
          securityLockReason: reason,
          securityCasePublicId: caseId,
          sellBannedAt: now,
          withdrawBlockedAt: now,
          suspiciousFundsHoldAt: now,
          sessionVersion: { increment: 1 },
        },
      });

      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'SECURITY' },
      });

      const event = await tx.securityEvent.create({
        data: {
          type: input.eventType === 'BAN_EVASION' ? 'BAN_EVASION' : 'SECURITY_LOCK',
          status: 'OPEN',
          userId: user.id,
          severity: input.level === 'CRITICAL' ? 95 : 80,
          payload: {
            kind: 'SECURITY_LOCK',
            level: input.level,
            eventType: input.eventType,
            reasons: input.reasons,
            related: input.related
              ? {
                orderId: input.related.orderId?.toString() ?? null,
                listingId: input.related.listingId ?? null,
                chatId: input.related.chatId ?? null,
                securityEventId: input.related.securityEventId?.toString() ?? null,
                messageId: input.related.messageId?.toString() ?? null,
              }
              : null,
            caseId,
          },
        },
      });

      const category: SupportTicketCategory = input.eventType === 'BAN_EVASION'
        ? 'BAN_EVASION'
        : 'RISK_ENGINE';
      const priority: SupportTicketPriority = input.level === 'CRITICAL' ? 'CRITICAL' : 'HIGH';

      const existing = await tx.supportTicket.findFirst({
        where: {
          reportedUserId: user.id,
          category: { in: ['RISK_ENGINE', 'BAN_EVASION'] },
          status: { in: ['OPEN', 'IN_REVIEW', 'WAITING_USER'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      const ticket = existing ?? await tx.supportTicket.create({
        data: {
          reportedUserId: user.id,
          relatedListingId: input.related?.listingId ?? null,
          relatedSecurityEventId: event.id,
          orderId: input.related?.orderId ?? null,
          chatId: input.related?.chatId ?? null,
          status: 'OPEN',
          category,
          priority,
          subject: `${input.eventType} · ${caseId}`,
          body: input.reasons.join('\n'),
        },
      });

      await tx.supportTicketEvent.create({
        data: {
          ticketId: ticket.id,
          kind: reused ? 'RISK_ENGINE_ATTACHED' : 'RISK_ENGINE_LOCK',
          message: reused
            ? `Risk Engine attached ${input.eventType} to existing lock ${caseId}`
            : `Automatic SECURITY LOCK (${input.level}) · ${input.eventType}`,
          payload: {
            reasons: input.reasons,
            eventId: event.id.toString(),
            caseId,
          },
        },
      });

      const note = await createDomainNotification(tx, {
        userId: user.id,
        type: 'SYSTEM',
        title: 'Аккаунт временно ограничен',
        body: `Подозрительная активность. ID дела: ${caseId}. Вы можете обжаловать решение.`,
        data: { caseId, ticketId: ticket.id, ticketNumber: ticket.publicNumber },
      });

      return { user, caseId, ticket, reused, notifyId: note.id, eventId: event.id };
    });

    deliverTelegramAfterCommit(this.prisma, [result.notifyId]);
    if (result.user.telegramId) {
      void pushTelegramToChatId(
        result.user.telegramId,
        'Аккаунт временно ограничен',
        `Причина: подозрительная активность\nID дела: ${result.caseId}\n\nДанные сохранены. Откройте ONIX → Профиль, чтобы обжаловать решение.`,
      );
    }

    this.logger.warn(JSON.stringify({
      msg: 'security_lock_applied',
      userId: input.userId.toString(),
      caseId: result.caseId,
      ticketId: result.ticket.id,
      level: input.level,
      reused: result.reused,
    }));

    return {
      locked: true,
      caseId: result.caseId,
      ticketId: result.ticket.id,
      ticketPublicNumber: result.ticket.publicNumber,
      reused: result.reused,
    };
  }

  async applyDecision(input: {
    userId: bigint;
    decision: 'KEEP_LOCK' | 'UNLOCK' | 'REDUCE_RESTRICTIONS' | 'PERMANENT_BAN';
    adminUserId: bigint;
    reason?: string;
    ticketId?: string;
  }): Promise<{ ok: true; decision: string }> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (input.decision === 'UNLOCK') {
        await tx.user.update({
          where: { id: input.userId },
          data: {
            securityLockedAt: null,
            securityLockLevel: null,
            securityLockReason: null,
            sellBannedAt: null,
            withdrawBlockedAt: null,
            suspiciousFundsHoldAt: null,
          },
        });
      } else if (input.decision === 'REDUCE_RESTRICTIONS') {
        await tx.user.update({
          where: { id: input.userId },
          data: {
            securityLockLevel: 'HIGH',
            withdrawBlockedAt: null,
            suspiciousFundsHoldAt: null,
          },
        });
      } else if (input.decision === 'PERMANENT_BAN') {
        await tx.user.update({
          where: { id: input.userId },
          data: {
            bannedAt: now,
            banReason: 'FRAUD',
            banComment: (input.reason ?? 'Confirmed fraud').slice(0, 1000),
            sellBannedAt: now,
            withdrawBlockedAt: now,
            sessionVersion: { increment: 1 },
          },
        });
        await tx.session.updateMany({
          where: { userId: input.userId, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'ADMIN' },
        });
        const banned = await tx.user.findUnique({
          where: { id: input.userId },
          select: { telegramId: true },
        });
        const sessions = await tx.session.findMany({
          where: { userId: input.userId },
          orderBy: { lastSeenAt: 'desc' },
          take: 10,
          select: { fingerprintHash: true, ipAddress: true, userAgent: true },
        });
        const links = await tx.identityLink.findMany({
          where: { userId: input.userId, deletedAt: null },
          select: { provider: true, providerUserId: true },
        });
        const rows: Array<{ kind: 'TELEGRAM_ID' | 'FINGERPRINT' | 'IP' | 'USER_AGENT'; valueHash: string; sourceUserId: bigint }> = [];
        const push = (kind: typeof rows[number]['kind'], raw?: string | null) => {
          const value = raw?.trim();
          if (!value) return;
          rows.push({
            kind,
            valueHash: createHash('sha256').update(value).digest('hex'),
            sourceUserId: input.userId,
          });
        };
        push('TELEGRAM_ID', banned?.telegramId?.toString() ?? null);
        for (const link of links) {
          if (link.provider === 'TELEGRAM') push('TELEGRAM_ID', link.providerUserId);
        }
        for (const session of sessions) {
          push('FINGERPRINT', session.fingerprintHash);
          push('IP', session.ipAddress);
          push('USER_AGENT', session.userAgent);
        }
        const unique = new Map(rows.map((r) => [`${r.kind}:${r.valueHash}`, r]));
        if (unique.size > 0) {
          await tx.abuseMarker.createMany({
            data: [...unique.values()],
            skipDuplicates: true,
          });
        }
      }

      if (input.ticketId) {
        await tx.supportTicketEvent.create({
          data: {
            ticketId: input.ticketId,
            kind: `DECISION_${input.decision}`,
            actorAdminId: input.adminUserId,
            message: input.reason?.trim()
              ? `${input.decision}: ${input.reason.trim().slice(0, 800)}`
              : input.decision,
          },
        });
        if (input.decision === 'UNLOCK' || input.decision === 'PERMANENT_BAN') {
          await tx.supportTicket.update({
            where: { id: input.ticketId },
            data: {
              status: input.decision === 'UNLOCK' ? 'RESOLVED' : 'CLOSED',
              closedAt: input.decision === 'PERMANENT_BAN' ? now : undefined,
            },
          });
        }
      }

      await tx.adminActionLog.create({
        data: {
          adminUserId: input.adminUserId,
          action: `SECURITY_${input.decision}`,
          targetType: 'User',
          targetId: input.userId.toString(),
          metadataJson: { reason: input.reason ?? null, ticketId: input.ticketId ?? null },
        },
      });
    });
    return { ok: true, decision: input.decision };
  }
}

function numericOnix(onixId: string): string {
  const digits = onixId.replace(/\D/g, '');
  return digits || onixId.slice(-6);
}

export function formatTicketPublicId(publicNumber: number): string {
  return `ONIX-${publicNumber}`;
}
