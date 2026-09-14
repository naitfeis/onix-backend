import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Header,
  Injectable, Module, NotFoundException, Optional, Param, Patch, Post, Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min,
} from 'class-validator';
import { ensurePairChat, pairChatKey } from './chat-pair';
import { AuthUser, CurrentUser, parseId } from './common';
import { createDomainNotification, deliverTelegramAfterCommit } from './domain-notify';
import { assertUsersNotBlocked } from './user-block';
import { formatOnixId, onixIdLookupCandidates } from './onix-id';
import { requireUserByOnixId } from './onix-id-lookup';
import { PrismaService } from './prisma.service';
import { statusBadge } from './platform-status';
import { publicDisplayName } from './public-username';
import { clientAvatarUrl } from './avatars/avatar-url';
import { assertRateLimit } from './rate-limit';
import { messageDto, notificationDto, reviewDto } from './response';
import { RealtimeBus } from './realtime/realtime-bus.service';
import { RealtimeModule } from './realtime/realtime.module';
import { RiskEngineService } from './risk/risk-engine.service';
import { RiskModule } from './risk/risk.module';
import { sanitizeChatText, sanitizeReviewText } from './sanitize-user-text';
import { hideReviewsForOrder, recomputeSellerRating } from './marketplace/review-aggregate';
import { canLeaveReview } from './marketplace/review-policy';
import { withSerializableTransaction } from './database/transaction-retry';
class DirectChatDto { @IsString() @Length(1, 32) onixId!: string; }
class MessageDto { @IsString() @Length(1, 2000) text!: string; }
class MessagesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  /** Cursor: load messages with id strictly less than this (older page). */
  @IsOptional() @IsString() @Length(1, 30) before?: string;
}
class ReviewDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @Length(1, 1000) text?: string;
}
class AppealReviewDto {
  @IsString() @Length(1, 1000) comment!: string;
}
class CreateGroupDto {
  @IsString() @Length(1, 80) title!: string;
  /** Excluding creator — soft cap keeps groups manageable for notify fan-out. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(31)
  @IsString({ each: true }) @Length(1, 64, { each: true })
  memberOnixIds!: string[];
}
class AddMembersDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(31)
  @IsString({ each: true }) @Length(1, 64, { each: true })
  memberOnixIds!: string[];
}
class ChatsQuery {
  @IsOptional() @IsString() @Length(1, 64) q?: string;
  /** Cursor from previous page (`updatedAt|id`). */
  @IsOptional() @IsString() @Length(1, 120) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 50;
}

/** Soft cap including the creator. */
export const MAX_GROUP_MEMBERS = 32;

function encodeChatListCursor(updatedAt: Date, id: string): string {
  return `${updatedAt.toISOString()}|${id}`;
}

function decodeChatListCursor(raw: string | undefined): { updatedAt: Date; id: string } | null {
  if (!raw?.trim()) return null;
  const sep = raw.indexOf('|');
  if (sep <= 0) return null;
  const updatedAt = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1).trim();
  if (!id || !Number.isFinite(updatedAt.getTime())) return null;
  return { updatedAt, id };
}
class UserSearchQuery {
  @IsString() @Length(1, 64) q!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) limit = 20;
}
class DeleteMessageDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

const SENDER_SELECT = {
  id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true, isAdmin: true, isSupport: true, platformStatus: true,
} as const;

/**
 * Chat + notification domain (HTTP polling today; methods are WS-ready — no transport in service).
 * Access: ChatMember only. senderId always = CurrentUser (never from body).
 * Read: opening a chat marks the thread read via ChatMember.updateMany (not per-message).
 * Personal chats: exactly one per user pair via Chat.pairKey (Direct + all Escrow deals).
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeBus,
    @Optional() private readonly risk?: RiskEngineService,
  ) {}

  async list(user: AuthUser, search?: string, cursorRaw?: string, limit = 50) {
    // Presence heartbeat owns lastSeenAt — avoid write on every chat poll.
    const q = search?.trim();
    const take = Math.min(Math.max(limit, 1), 50);
    const cursor = decodeChatListCursor(cursorRaw);
    const chats = await this.prisma.chat.findMany({
      where: {
        members: { some: { userId: user.id } },
        AND: [
          ...(cursor ? [{
            OR: [
              { updatedAt: { lt: cursor.updatedAt } },
              { AND: [{ updatedAt: cursor.updatedAt }, { id: { lt: cursor.id } }] },
            ],
          }] : []),
          ...(q ? [{
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              {
                members: {
                  some: {
                    userId: { not: user.id },
                    user: {
                      OR: [
                        { displayName: { contains: q, mode: 'insensitive' as const } },
                        { onixId: { in: onixIdLookupCandidates(q) } },
                      ],
                    },
                  },
                },
              },
            ],
          }] : []),
        ],
      },
      include: {
        members: {
          where: { OR: [{ userId: user.id }, { userId: { not: user.id } }] },
          include: {
            user: {
              select: {
                id: true, onixId: true, displayName: true, telegramNick: true, lastSeenAt: true, avatarUrl: true,
                isAdmin: true, isSupport: true, platformStatus: true,
              },
            },
          },
        },
        messages: {
          where: {
            OR: [{ visibleToUserId: null }, { visibleToUserId: user.id }],
            hides: { none: { userId: user.id } },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { text: true, kind: true, deletedAt: true },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, totalAmountCents: true, product: { select: { title: true } } },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    if (chats.length === 0) return { items: [], nextCursor: null as string | null };

    const page = chats.slice(0, take);
    const chatIds = page.map((chat) => chat.id);
    const unreadRows = await this.prisma.$queryRaw<Array<{ chatId: string; cnt: bigint }>>`
      SELECT m."chatId" AS "chatId", COUNT(*)::bigint AS cnt
      FROM "Message" m
      INNER JOIN "ChatMember" cm
        ON cm."chatId" = m."chatId" AND cm."userId" = ${user.id}
      WHERE m."chatId" IN (${Prisma.join(chatIds)})
        AND m.kind = 'USER'
        AND m."senderId" IS NOT NULL
        AND m."senderId" <> ${user.id}
        AND m."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "MessageHide" h
          WHERE h."messageId" = m.id AND h."userId" = ${user.id}
        )
        AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
      GROUP BY m."chatId"
    `;
    const unreadByChat = new Map(unreadRows.map((row) => [row.chatId, Number(row.cnt)]));

    const mapped = page.map((chat) => {
      const isGroup = chat.kind === 'GROUP';
      const other = chat.members.find((member) => (
        member.userId !== user.id
        && !member.user.isAdmin
        && !member.user.isSupport
      )) ?? chat.members.find((member) => member.userId !== user.id);
      const latestOrder = chat.orders[0];
      const subtitleRaw = chat.messages[0];
      const subtitle = subtitleRaw?.deletedAt
        ? 'Сообщение удалено'
        : subtitleRaw?.text;
      const peerOnix = other?.user.onixId ? formatOnixId(other.user.onixId) : undefined;
      const isAi = chat.kind === 'AI';
      return {
        id: chat.id,
        kind: chat.kind,
        title: isAi
            ? (chat.title?.trim() || 'Onix AI')
            : isGroup
            ? (chat.title ?? 'Группа')
            : (other
              ? publicDisplayName(other.user.displayName, peerOnix ?? other.user.onixId)
              : (peerOnix ?? 'Диалог')),
        subtitle,
        unreadCount: unreadByChat.get(chat.id) ?? 0,
        peerOnixId: isGroup || isAi ? undefined : peerOnix,
        peerLastOnline: isGroup || isAi ? undefined : other?.user.lastSeenAt?.toISOString(),
        ...(!isGroup && !isAi && other
          ? {
            peerAvatarUrl: clientAvatarUrl(other.user.id, other.user.avatarUrl),
            peerUserId: other.user.id.toString(),
          }
          : {}),
        ...(!isGroup && !isAi && other
          ? (() => {
            const b = statusBadge(other.user.platformStatus
              ?? (other.user.isAdmin ? 'ADMIN' : other.user.isSupport ? 'MODERATOR' : 'USER'));
            return b ? { peerBadge: b } : {};
          })()
          : {}),
        ...(latestOrder ? {
          dealId: latestOrder.id.toString(),
          orderCard: {
            id: latestOrder.id.toString(),
            productTitle: latestOrder.product.title,
            totalAmountCents: latestOrder.totalAmountCents.toString(),
            status: latestOrder.status,
            escrow: true,
          },
        } : {}),
        _updatedAt: chat.updatedAt,
      };
    });

    // Keep AI helper pinned on the first page only.
    const items = (!cursor
      ? mapped.sort((a, b) => {
        if (a.kind === 'AI' && b.kind !== 'AI') return -1;
        if (b.kind === 'AI' && a.kind !== 'AI') return 1;
        return 0;
      })
      : mapped
    ).map(({ _updatedAt: _ignored, ...row }) => row);

    const last = page[page.length - 1];
    const nextCursor = chats.length > take && last
      ? encodeChatListCursor(last.updatedAt, last.id)
      : null;
    return { items, nextCursor };
  }

  async searchUsers(user: AuthUser, q: string, limit: number) {
    const query = q.trim().replace(/^@+/, '');
    if (!query) return [];
    const take = Math.min(Math.max(limit, 1), 30);
    const candidates = onixIdLookupCandidates(query);
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        id: { not: user.id },
        OR: [
          { onixId: { in: candidates } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      take,
      select: {
        id: true, onixId: true, displayName: true, avatarUrl: true, isAdmin: true, isSupport: true, platformStatus: true,
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => {
      const onixId = formatOnixId(row.onixId);
      const badge = statusBadge(row.platformStatus
        ?? (row.isAdmin ? 'ADMIN' : row.isSupport ? 'MODERATOR' : 'USER'));
      return {
        onixId,
        username: publicDisplayName(row.displayName, onixId),
        avatarUrl: clientAvatarUrl(row.id, row.avatarUrl),
        ...(badge ? { badge } : {}),
      };
    });
  }

  async createGroup(user: AuthUser, title: string, memberOnixIds: string[]) {
    const name = title.trim();
    if (!name) throw new BadRequestException('Укажите название группы.');
    const unique = [...new Set(memberOnixIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length < 1) throw new BadRequestException('Добавьте хотя бы одного участника.');
    if (unique.length > MAX_GROUP_MEMBERS - 1) {
      throw new BadRequestException(`В группе максимум ${MAX_GROUP_MEMBERS} участников (включая вас).`);
    }
    const members: Array<{ id: bigint; onixId: string; deletedAt: Date | null }> = [];
    const missing: string[] = [];
    for (const raw of unique) {
      try {
        const u = await requireUserByOnixId(this.prisma, raw);
        if (u.id === user.id) continue;
        if (u.deletedAt) {
          missing.push(formatOnixId(u.onixId));
          continue;
        }
        members.push({ id: u.id, onixId: u.onixId, deletedAt: u.deletedAt });
      } catch {
        missing.push(formatOnixId(raw) || raw);
      }
    }
    if (members.length < 1) {
      throw new BadRequestException(
        missing.length ? `${missing.join(', ')} не найден` : 'Добавьте хотя бы одного участника.',
      );
    }
    if (members.length + 1 > MAX_GROUP_MEMBERS) {
      throw new BadRequestException(`В группе максимум ${MAX_GROUP_MEMBERS} участников (включая вас).`);
    }

    const chat = await withSerializableTransaction(this.prisma, async (tx) => {
      // Creator first (earlier createdAt) so addMembers owner check is stable.
      const created = await tx.chat.create({
        data: {
          kind: 'GROUP',
          title: name.slice(0, 80),
          members: { create: { userId: user.id } },
        },
      });
      if (members.length) {
        await tx.chatMember.createMany({
          data: members.map((m) => ({ chatId: created.id, userId: m.id })),
        });
      }
      await tx.message.create({
        data: {
          chatId: created.id,
          senderId: null,
          kind: 'SYSTEM',
          text: `Группа «${name.slice(0, 80)}» создана.`,
        },
      });
      return created;
    });

    return {
      id: chat.id,
      kind: 'GROUP' as const,
      title: name.slice(0, 80),
      unreadCount: 0,
      ...(missing.length ? { missing } : {}),
    };
  }

  async direct(user: AuthUser, onixId: string) {
    const target = await requireUserByOnixId(this.prisma, onixId);
    if (target.id === user.id) throw new BadRequestException('Нельзя открыть чат с собой.');
    await this.assertNotBlocked(user.id, target.id);

    const pairKey = pairChatKey(user.id, target.id);
    let chat: { id: string };
    try {
      chat = await withSerializableTransaction(
        this.prisma,
        (tx) => ensurePairChat(tx, user.id, target.id),
      );
    } catch (error) {
      if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code: string }).code === 'P2002'
      ) {
        chat = await this.prisma.chat.findUniqueOrThrow({ where: { pairKey } });
      } else {
        throw error;
      }
    }

    const peerOnix = formatOnixId(target.onixId);
    return {
      id: chat.id,
      kind: 'DIRECT' as const,
      title: publicDisplayName(target.displayName, peerOnix),
      unreadCount: 0,
      peerOnixId: peerOnix,
      peerLastOnline: target.lastSeenAt.toISOString(),
      peerAvatarUrl: clientAvatarUrl(target.id, target.avatarUrl),
      peerUserId: target.id.toString(),
    };
  }

  async messages(user: AuthUser, chatId: string, limit: number, before?: string) {
    await this.member(user.id, chatId);
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId }, select: { kind: true } });
    if (!chat) throw new NotFoundException('Чат не найден.');
    const take = Math.min(Math.max(limit, 1), 100);
    const beforeId = before ? parseId(before) : undefined;

    const memberRows = await this.prisma.chatMember.findMany({
      where: { chatId },
      include: {
        user: { select: { onixId: true, displayName: true, telegramNick: true } },
      },
    });
    const memberReads = memberRows.map((m) => ({
      userId: m.userId,
      onixId: m.user.onixId,
      username: publicDisplayName(m.user.displayName, m.user.onixId),
      lastReadAt: m.lastReadAt,
    }));

    const rows = await this.prisma.message.findMany({
      where: {
        chatId,
        OR: [{ visibleToUserId: null }, { visibleToUserId: user.id }],
        hides: { none: { userId: user.id } },
        ...(beforeId !== undefined ? { id: { lt: beforeId } } : {}),
        // Non-staff: still see soft-deleted as placeholder (filter none); staff see all.
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: { sender: { select: SENDER_SELECT } },
    });

    await this.prisma.chatMember.updateMany({
      where: { chatId, userId: user.id },
      data: { lastReadAt: new Date() },
    });
    void this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    return rows.reverse().map((message) => messageDto(message, user.id, {
      staffViewer: false,
      memberReads,
    }));
  }

  async send(user: AuthUser, chatId: string, text: string) {
    await this.member(user.id, chatId);
    const body = sanitizeChatText(text, 2000);
    if (!body) throw new BadRequestException('Сообщение не может быть пустым.');

    const chat = await this.prisma.chat.findUnique({ where: { id: chatId }, select: { kind: true } });
    if (!chat) throw new NotFoundException('Чат не найден.');
    if (chat.kind === 'AI') {
      throw new BadRequestException('Это чат с ONIX AI — напишите сообщение в диалоге Onix AI.');
    }

    assertRateLimit(`chat-send:${user.id}`, 60, 60_000);
    if (this.risk) {
      await this.risk.inspectChatMessage({ userId: user.id, chatId, text: body });
    }

    const others = await this.prisma.chatMember.findMany({
      where: { chatId, userId: { not: user.id } },
      select: { userId: true },
    });
    if (others.length === 0) throw new BadRequestException('В чате нет получателя.');
    for (const other of others) {
      await this.assertNotBlocked(user.id, other.userId);
    }

    const memberRows = await this.prisma.chatMember.findMany({
      where: { chatId },
      include: { user: { select: { onixId: true, displayName: true, telegramNick: true } } },
    });
    const memberReads = memberRows.map((m) => ({
      userId: m.userId,
      onixId: m.user.onixId,
      username: publicDisplayName(m.user.displayName, m.user.onixId),
      lastReadAt: m.lastReadAt,
    }));

    // Keep the message write short — fan-out notifications after commit.
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { chatId, senderId: user.id, kind: 'USER', text: body },
        include: { sender: { select: SENDER_SELECT } },
      });
      await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
      return created;
    });

    const notifyIds: bigint[] = [];
    try {
      for (const other of others) {
        const note = await createDomainNotification(this.prisma, {
          userId: other.userId,
          type: 'NEW_MESSAGE',
          title: 'Новое сообщение',
          body: body.slice(0, 160),
          data: { chatId },
        });
        notifyIds.push(note.id);
      }
    } catch {
      // Message already committed — worker/outbox can still recover missing rows later if needed.
    }
    deliverTelegramAfterCommit(this.prisma, notifyIds);

    this.fanoutChatMessage(
      chatId,
      message,
      user,
      others.map((o) => o.userId),
      memberReads,
    );

    return messageDto(message, user.id, {
      staffViewer: false,
      memberReads,
    });
  }

  private fanoutChatMessage(
    chatId: string,
    message: {
      id: bigint;
      chatId: string;
      senderId: bigint | null;
      kind?: string;
      text: string;
      createdAt: Date;
      deletedAt?: Date | null;
      deletedById?: bigint | null;
      deletedReason?: string | null;
      sender: Parameters<typeof messageDto>[0]['sender'];
    },
    sender: AuthUser,
    peerIds: bigint[],
    memberReads: Array<{
      userId: bigint;
      onixId: string;
      username: string;
      lastReadAt: Date | null;
    }>,
  ): void {
    const messageByViewer = new Map<string, Record<string, unknown>>();
    const viewers = [sender.id, ...peerIds];
    for (const viewerId of viewers) {
      messageByViewer.set(
        viewerId.toString(),
        messageDto(message, viewerId, {
          staffViewer: false,
          memberReads: viewerId === sender.id ? memberReads : undefined,
        }) as unknown as Record<string, unknown>,
      );
    }
    this.realtime.publish({
      kind: 'chat.message',
      chatId,
      recipientUserIds: peerIds,
      messageByViewer,
      senderId: sender.id,
    });
    for (const peerId of peerIds) {
      this.realtime.publish({
        kind: 'notification',
        userId: peerId,
        id: `msg-${message.id.toString()}`,
        title: 'Новое сообщение',
        body: message.text.slice(0, 160),
        createdAt: message.createdAt.toISOString(),
        data: { chatId },
      });
    }
  }

  /** Hide message for current user only. */
  async hideForSelf(user: AuthUser, chatId: string, messageId: bigint) {
    await this.member(user.id, chatId);
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, chatId },
    });
    if (!message) throw new NotFoundException('Сообщение не найдено.');
    await this.prisma.messageHide.upsert({
      where: { messageId_userId: { messageId, userId: user.id } },
      create: { messageId, userId: user.id },
      update: {},
    });
    return { ok: true, scope: 'SELF' as const };
  }

  /** Soft-delete globally. Only the sender may delete their own message. */
  async softDelete(user: AuthUser, chatId: string, messageId: bigint, reason?: string) {
    await this.member(user.id, chatId);
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, chatId },
    });
    if (!message) throw new NotFoundException('Сообщение не найдено.');
    const own = message.senderId === user.id;
    if (!own) {
      throw new ForbiddenException('Удалить у всех может только отправитель.');
    }
    if (message.deletedAt) return { ok: true, scope: 'GLOBAL' as const };
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        deletedById: user.id,
        deletedForAll: true,
        deletedReason: reason?.trim().slice(0, 500) || null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'MESSAGE_SOFT_DELETE',
        entity: 'Message',
        entityId: messageId.toString(),
        metadata: { chatId, reason: reason?.trim() ?? null, deletedForAll: true },
      },
    });
    return { ok: true, scope: 'GLOBAL' as const };
  }

  /** Add members to an existing group chat (creator / earliest member only). */
  async addMembers(user: AuthUser, chatId: string, memberOnixIds: string[]) {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat) throw new NotFoundException('Чат не найден.');
    if (chat.kind !== 'GROUP') throw new BadRequestException('Добавлять участников можно только в группу.');
    await this.member(user.id, chatId);

    const creator = await this.prisma.chatMember.findFirst({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    if (!creator || creator.userId !== user.id) {
      throw new ForbiddenException('Добавлять участников может только создатель группы.');
    }

    const unique = [...new Set(memberOnixIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length < 1) throw new BadRequestException('Укажите участников.');

    const currentCount = await this.prisma.chatMember.count({ where: { chatId } });
    if (currentCount >= MAX_GROUP_MEMBERS) {
      throw new BadRequestException(`В группе максимум ${MAX_GROUP_MEMBERS} участников.`);
    }

    const added: string[] = [];
    const missing: string[] = [];
    const already: string[] = [];
    let liveCount = currentCount;

    for (const raw of unique) {
      if (liveCount >= MAX_GROUP_MEMBERS) break;
      try {
        const target = await requireUserByOnixId(this.prisma, raw);
        if (target.id === user.id || target.deletedAt) {
          missing.push(formatOnixId(raw) || raw);
          continue;
        }
        const exists = await this.prisma.chatMember.findUnique({
          where: { chatId_userId: { chatId, userId: target.id } },
        });
        if (exists) {
          already.push(formatOnixId(target.onixId));
          continue;
        }
        await this.prisma.chatMember.create({ data: { chatId, userId: target.id } });
        added.push(formatOnixId(target.onixId));
        liveCount += 1;
      } catch {
        missing.push(formatOnixId(raw) || raw);
      }
    }

    if (added.length < unique.length && liveCount >= MAX_GROUP_MEMBERS && missing.length === 0) {
      // Soft cap hit mid-batch — still return partial adds below.
    }

    if (added.length > 0) {
      await this.prisma.message.create({
        data: {
          chatId,
          senderId: null,
          kind: 'SYSTEM',
          text: `Добавлены: ${added.join(', ')}`,
        },
      });
      await this.prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
    }

    if (added.length < 1 && missing.length > 0) {
      throw new BadRequestException(`${missing.join(', ')} не найден`);
    }

    return { added, missing, already };
  }

  async listMembers(user: AuthUser, chatId: string) {
    await this.member(user.id, chatId);
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId }, select: { kind: true, title: true } });
    if (!chat) throw new NotFoundException('Чат не найден.');
    const rows = await this.prisma.chatMember.findMany({
      where: { chatId },
      select: {
        user: {
          select: {
            id: true, onixId: true, telegramNick: true, displayName: true, avatarUrl: true,
            isAdmin: true, isSupport: true, platformStatus: true, lastSeenAt: true, deletedAt: true,
          },
        },
      },
      take: 200,
    });
    return {
      chatId,
      kind: chat.kind,
      title: chat.title,
      members: rows
        .filter((r) => !r.user.deletedAt)
        .map((r) => {
          const onixId = formatOnixId(r.user.onixId);
          return {
            onixId,
            username: publicDisplayName(r.user.displayName, onixId),
            avatarUrl: clientAvatarUrl(r.user.id, r.user.avatarUrl),
            badge: statusBadge(r.user.platformStatus
              ?? (r.user.isAdmin ? 'ADMIN' : r.user.isSupport ? 'MODERATOR' : 'USER')),
            lastOnline: r.user.lastSeenAt.toISOString(),
          };
        }),
    };
  }

  /** Leave a group chat (does not delete the group for others). */
  async leaveGroup(user: AuthUser, chatId: string) {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat) throw new NotFoundException('Чат не найден.');
    if (chat.kind !== 'GROUP') throw new BadRequestException('Выйти можно только из группы.');
    await this.member(user.id, chatId);
    await this.prisma.chatMember.delete({
      where: { chatId_userId: { chatId, userId: user.id } },
    });
    await this.prisma.message.create({
      data: {
        chatId,
        senderId: null,
        kind: 'SYSTEM',
        text: `${formatOnixId(user.onixId)} вышел(а) из группы`,
      },
    });
    await this.prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
    return { ok: true as const };
  }

  private async member(userId: bigint, chatId: string) {
    const member = await this.prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId } } });
    if (!member) throw new NotFoundException('Чат не найден.');
    return member;
  }

  private async assertNotBlocked(a: bigint, b: bigint) {
    await assertUsersNotBlocked(
      this.prisma,
      a,
      b,
      'Обмен сообщениями между пользователями заблокирован.',
    );
  }
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const items = await this.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, title: true, body: true, readAt: true, createdAt: true, type: true, data: true },
    });
    return items.map(notificationDto);
  }

  /** Own notification only — updateMany prevents cross-user mark-read races. */
  read(user: AuthUser, id: bigint) {
    return this.prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { readAt: new Date() },
    });
  }
}

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async list(onixId: string) {
    const subject = await requireUserByOnixId(this.prisma, onixId);
    const reviews = await this.prisma.review.findMany({
      where: { subjectId: subject.id, hiddenAt: null },
      include: {
        author: { select: { id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true, isAdmin: true, isSupport: true, platformStatus: true } },
        order: { select: { totalAmountCents: true, product: { select: { title: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return reviews.map(reviewDto);
  }

  async hideForRefundedOrder(orderId: bigint) {
    await this.prisma.$transaction(async (tx) => {
      await hideReviewsForOrder(tx as never, orderId, 'REFUND');
    });
  }

  async appeal(user: AuthUser, reviewId: bigint, comment: string) {
    const text = comment.trim();
    if (!text) throw new BadRequestException('Укажите причину обжалования.');
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { subject: { select: { id: true, onixId: true } } },
    });
    if (!review || review.hiddenAt) throw new NotFoundException('Отзыв не найден.');
    if (review.subjectId !== user.id) {
      throw new ForbiddenException('Обжаловать отзыв может только продавец.');
    }
    const existing = await this.prisma.userReport.findFirst({
      where: { reviewId, reporterId: user.id, closedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Обжалование по этому отзыву уже отправлено.');
    const report = await this.prisma.userReport.create({
      data: {
        reporterId: user.id,
        targetId: review.authorId,
        reason: 'OTHER',
        comment: text.slice(0, 1000),
        kind: 'REVIEW_APPEAL',
        reviewId,
      },
    });
    return { id: report.id, reviewId: review.id.toString() };
  }

  async hideOnAppeal(reviewId: bigint) {
    await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({ where: { id: reviewId } });
      if (!review || review.hiddenAt) return;
      await tx.review.update({
        where: { id: reviewId },
        data: { hiddenAt: new Date(), hiddenReason: 'APPEAL' },
      });
      await recomputeSellerRating(tx as never, review.subjectId, { floorPrevious: true });
    });
  }

  async create(user: AuthUser, orderId: bigint, dto: ReviewDto) {
    try {
      const result = await withSerializableTransaction(this.prisma, async (tx) => {
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order || !canLeaveReview({
          status: order.status,
          buyerId: order.buyerId,
          authorId: user.id,
          totalAmountCents: order.totalAmountCents,
        })) {
          throw new BadRequestException('Отзыв доступен только после завершённой сделки от 100 ₽.');
        }
        const subjectId = order.sellerId;
        if (subjectId === user.id) {
          throw new BadRequestException('Нельзя оставить отзыв самому себе.');
        }
        const existing = await tx.review.findUnique({
          where: { orderId_authorId: { orderId, authorId: user.id } },
        });
        if (existing) {
          throw new ConflictException('Отзыв по этой сделке уже оставлен.');
        }
        const cleanText = sanitizeReviewText(dto.text);
        const review = await tx.review.create({
          data: {
            orderId,
            authorId: user.id,
            subjectId,
            rating: dto.rating,
            ...(cleanText !== undefined ? { text: cleanText } : {}),
          },
        });
        await recomputeSellerRating(tx as never, subjectId);
        const note = await createDomainNotification(tx, {
          userId: subjectId,
          type: 'NEW_REVIEW',
          title: 'Оставлен отзыв',
          body: `Оценка: ${dto.rating}/5`,
          data: { reviewId: review.id.toString() },
        });
        const row = await tx.review.findUniqueOrThrow({
          where: { id: review.id },
          include: {
            author: { select: { id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true, isAdmin: true, isSupport: true, platformStatus: true } },
            order: { select: { totalAmountCents: true, product: { select: { title: true } } } },
          },
        });
        return { dto: reviewDto(row), notifyIds: [note.id] };
      });

      deliverTelegramAfterCommit(this.prisma, result.notifyIds);
      return result.dto;
    } catch (error) {
      if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException('Отзыв по этой сделке уже оставлен.');
      }
      throw error;
    }
  }
}

@Controller()
export class EngagementController {
  constructor(
    private readonly chats: ChatService,
    private readonly notifications: NotificationService,
    private readonly reviews: ReviewService,
  ) {}

  @Get('chats')
  @Header('Cache-Control', 'private, no-store')
  listChats(@CurrentUser() user: AuthUser, @Query() query: ChatsQuery) {
    return this.chats.list(user, query.q, query.cursor, query.limit);
  }

  @Get('chats/users/search')
  @Header('Cache-Control', 'private, no-store')
  searchUsers(@CurrentUser() user: AuthUser, @Query() query: UserSearchQuery) {
    assertRateLimit(`chat-search:${user.id}`, 30, 60_000);
    return this.chats.searchUsers(user, query.q, query.limit);
  }

  @Post('chats/direct') direct(@CurrentUser() user: AuthUser, @Body() dto: DirectChatDto) {
    return this.chats.direct(user, dto.onixId);
  }

  @Post('chats/groups')
  createGroup(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) {
    return this.chats.createGroup(user, dto.title, dto.memberOnixIds);
  }

  @Post('chats/:id/members')
  addMembers(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddMembersDto) {
    return this.chats.addMembers(user, id, dto.memberOnixIds);
  }

  @Delete('chats/:id/members/me')
  leaveGroup(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chats.leaveGroup(user, id);
  }

  @Get('chats/:id/members')
  @Header('Cache-Control', 'private, no-store')
  listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chats.listMembers(user, id);
  }

  @Get('chats/:id/messages') messages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: MessagesQuery,
  ) {
    return this.chats.messages(user, id, query.limit, query.before);
  }

  @Post('chats/:id/messages') send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MessageDto,
  ) {
    return this.chats.send(user, id, dto.text);
  }

  @Delete('chats/:id/messages/:messageId')
  deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Query('scope') scope: string | undefined,
    @Body() body?: DeleteMessageDto,
  ) {
    const mid = parseId(messageId);
    if (scope === 'global') {
      return this.chats.softDelete(user, id, mid, body?.reason);
    }
    return this.chats.hideForSelf(user, id, mid);
  }

  @Get('notifications') listNotifications(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user);
  }
  @Patch('notifications/:id/read') readNotification(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.read(user, parseId(id));
  }

  @Get('users/:onixId/reviews') listReviews(
    @CurrentUser() user: AuthUser,
    @Param('onixId') id: string,
  ) {
    assertRateLimit(`reviews:${user.id}`, 60, 60_000);
    return this.reviews.list(id);
  }
  @Post('orders/:id/reviews') createReview(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewDto,
  ) {
    assertRateLimit(`review-create:${user.id}`, 10, 60_000);
    return this.reviews.create(user, parseId(id), dto);
  }

  @Post('reviews/:id/appeal')
  appealReview(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AppealReviewDto,
  ) {
    assertRateLimit(`review-appeal:${user.id}`, 8, 60_000);
    return this.reviews.appeal(user, parseId(id), dto.comment);
  }
}

@Module({
  imports: [RealtimeModule, RiskModule],
  controllers: [EngagementController],
  providers: [ChatService, NotificationService, ReviewService],
})
export class EngagementModule {}
