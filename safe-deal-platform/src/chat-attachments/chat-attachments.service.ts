import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttachmentStatus, MessageContentType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthUser } from '../common';
import { createDomainNotification, pushTelegramToChatId } from '../domain-notify';
import { publicDisplayName } from '../public-username';
import { PrismaService } from '../prisma.service';
import { assertRateLimit } from '../rate-limit';
import { RealtimeBus } from '../realtime/realtime-bus.service';
import { messageDto } from '../response';
import {
  ALLOWED_MIME,
  attachmentTierForUser,
  contentTypeForMime,
  getAttachmentMaxBytes,
  sanitizeOriginalName,
} from './attachment-policy';
import { detectMimeFromMagic, mimeMatchesMagic } from './magic-bytes';
import { R2StorageService } from './r2-storage.service';

const SENDER_SELECT = {
  id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true,
  isAdmin: true, isSupport: true, platformStatus: true,
} as const;

const PUT_URL_TTL_SEC = 600;
const GET_URL_TTL_SEC = 60;
const PENDING_TTL_MS = 60 * 60_000;

@Injectable()
export class ChatAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2StorageService,
    private readonly realtime: RealtimeBus,
  ) {}

  private async requireMember(userId: bigint, chatId: string) {
    const row = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!row) throw new ForbiddenException('Нет доступа к чату.');
  }

  async uploadIntent(
    user: AuthUser,
    chatId: string,
    body: { mimeType: string; sizeBytes: number; originalName: string },
  ) {
    if (!this.r2.isConfigured()) {
      throw new BadRequestException('Загрузка файлов временно недоступна.');
    }

    await this.requireMember(user.id, chatId);
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId }, select: { kind: true } });
    if (!chat) throw new NotFoundException('Чат не найден.');
    if (chat.kind === 'AI') throw new BadRequestException('Чат ONIX AI больше недоступен.');

    assertRateLimit(`attach-intent:${user.id}`, 30, 60_000);
    assertRateLimit(`attach-cooldown:${user.id}`, 1, 1_000);

    const mimeType = (body.mimeType || '').trim().toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) {
      throw new BadRequestException('Тип файла не разрешён. Допустимы: JPEG, PNG, WebP, GIF, PDF, TXT.');
    }
    const sizeBytes = Number(body.sizeBytes);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new BadRequestException('Некорректный размер файла.');
    }
    const tier = attachmentTierForUser(user);
    const maxBytes = getAttachmentMaxBytes(tier);
    if (sizeBytes > maxBytes) {
      throw new BadRequestException(`Файл слишком большой. Лимит: ${Math.floor(maxBytes / (1024 * 1024))} МБ.`);
    }

    const originalName = sanitizeOriginalName(body.originalName || 'file');
    const storageKey = `chat-attachments/${chatId}/${randomUUID()}`;

    const attachment = await this.prisma.chatAttachment.create({
      data: {
        chatId,
        ownerId: user.id,
        originalName,
        mimeType,
        sizeBytes,
        storageKey,
        status: AttachmentStatus.PENDING,
      },
    });

    const uploadUrl = await this.r2.presignPut(storageKey, mimeType, PUT_URL_TTL_SEC);

    return {
      attachmentId: attachment.id,
      uploadUrl,
      headers: { 'Content-Type': mimeType },
      expiresAt: new Date(Date.now() + PUT_URL_TTL_SEC * 1000).toISOString(),
      maxBytes,
      contentType: contentTypeForMime(mimeType),
    };
  }

  async complete(
    user: AuthUser,
    chatId: string,
    attachmentId: string,
    caption?: string,
  ) {
    if (!this.r2.isConfigured()) {
      throw new BadRequestException('Загрузка файлов временно недоступна.');
    }

    await this.requireMember(user.id, chatId);
    assertRateLimit(`attach-complete:${user.id}`, 30, 60_000);
    assertRateLimit(`attach-cooldown:${user.id}`, 1, 1_000);

    const attachment = await this.prisma.chatAttachment.findFirst({
      where: { id: attachmentId, chatId },
    });
    if (!attachment) throw new NotFoundException('Вложение не найдено.');
    if (attachment.ownerId !== user.id) {
      throw new ForbiddenException('Это не ваше вложение.');
    }

    if (attachment.messageId && attachment.status === AttachmentStatus.READY) {
      const existing = await this.prisma.message.findUnique({
        where: { id: attachment.messageId },
        include: { sender: { select: SENDER_SELECT }, attachment: true },
      });
      if (existing) {
        return messageDto(existing, user.id, {
          staffViewer: false,
          memberReads: await this.memberReads(chatId),
        });
      }
    }

    if (attachment.status !== AttachmentStatus.PENDING) {
      throw new BadRequestException('Вложение уже обработано.');
    }

    let head: { contentLength: number };
    try {
      head = await this.r2.head(attachment.storageKey);
    } catch {
      await this.prisma.chatAttachment.update({
        where: { id: attachment.id },
        data: { status: AttachmentStatus.REJECTED },
      });
      throw new BadRequestException('Файл не найден в хранилище. Загрузите снова.');
    }

    const tier = attachmentTierForUser(user);
    const maxBytes = getAttachmentMaxBytes(tier);
    if (head.contentLength <= 0 || head.contentLength > maxBytes) {
      await this.rejectAndDelete(attachment.id, attachment.storageKey);
      throw new BadRequestException('Размер файла после загрузки превышает лимит.');
    }
    if (head.contentLength > attachment.sizeBytes) {
      await this.rejectAndDelete(attachment.id, attachment.storageKey);
      throw new BadRequestException('Файл больше заявленного размера.');
    }

    const sample = await this.r2.getRange(attachment.storageKey, 0, 511);
    const detected = detectMimeFromMagic(sample);
    if (!mimeMatchesMagic(attachment.mimeType, detected) || !detected) {
      await this.rejectAndDelete(attachment.id, attachment.storageKey);
      throw new BadRequestException('Содержимое файла не соответствует типу.');
    }

    const contentType = contentTypeForMime(detected) as MessageContentType;
    const text = (caption?.trim() || (contentType === 'FILE' ? attachment.originalName : '')).slice(0, 4500);

    const others = await this.prisma.chatMember.findMany({
      where: { chatId, userId: { not: user.id } },
      select: { userId: true },
    });
    if (others.length === 0) throw new BadRequestException('В чате нет получателя.');

    const memberReads = await this.memberReads(chatId);

    let message;
    try {
      message = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.chatAttachment.findUnique({ where: { id: attachment.id } });
        if (!fresh) throw new NotFoundException('Вложение не найдено.');
        if (fresh.messageId) {
          const existing = await tx.message.findUnique({
            where: { id: fresh.messageId },
            include: { sender: { select: SENDER_SELECT }, attachment: true },
          });
          if (existing) return existing;
        }
        if (fresh.status !== AttachmentStatus.PENDING) {
          throw new BadRequestException('Вложение уже обработано.');
        }

        const created = await tx.message.create({
          data: {
            chatId,
            senderId: user.id,
            kind: 'USER',
            contentType,
            text,
            metadata: {
              attachmentId: attachment.id,
              mimeType: detected,
              sizeBytes: head.contentLength,
            } as Prisma.InputJsonValue,
          },
          include: { sender: { select: SENDER_SELECT } },
        });

        const linked = await tx.chatAttachment.update({
          where: { id: attachment.id },
          data: {
            status: AttachmentStatus.READY,
            messageId: created.id,
            sizeBytes: head.contentLength,
            mimeType: detected,
          },
        });

        await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });

        for (const other of others) {
          await createDomainNotification(tx, {
            userId: other.userId,
            type: 'NEW_MESSAGE',
            title: 'Новое сообщение',
            body: (text || (contentType === 'IMAGE' ? 'Изображение' : `Файл: ${attachment.originalName}`)).slice(0, 160),
            data: { chatId },
          });
        }

        return { ...created, attachment: linked };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await this.prisma.chatAttachment.findUnique({
          where: { id: attachment.id },
          include: {
            message: { include: { sender: { select: SENDER_SELECT }, attachment: true } },
          },
        });
        if (again?.message) {
          return messageDto(again.message, user.id, {
            staffViewer: false,
            memberReads,
          });
        }
      }
      throw error;
    }

    const peers = await this.prisma.user.findMany({
      where: { id: { in: others.map((o) => o.userId) } },
      select: { telegramId: true },
    });
    const preview = text || (contentType === 'IMAGE' ? 'Изображение' : attachment.originalName);
    for (const peer of peers) {
      void pushTelegramToChatId(peer.telegramId, 'Новое сообщение', preview.slice(0, 200));
    }

    this.fanout(chatId, message, user, others.map((o) => o.userId), memberReads);

    return messageDto(message, user.id, {
      staffViewer: false,
      memberReads,
    });
  }

  async downloadUrl(user: AuthUser, attachmentId: string) {
    if (!this.r2.isConfigured()) {
      throw new BadRequestException('Файлы временно недоступны.');
    }

    const attachment = await this.prisma.chatAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment || attachment.status !== AttachmentStatus.READY) {
      throw new NotFoundException('Вложение не найдено.');
    }

    await this.requireMember(user.id, attachment.chatId);
    assertRateLimit(`attach-dl:${user.id}`, 120, 60_000);

    const inline = attachment.mimeType.startsWith('image/');
    const url = await this.r2.presignGet(attachment.storageKey, {
      mimeType: attachment.mimeType,
      originalName: attachment.originalName,
      inline,
      expiresIn: GET_URL_TTL_SEC,
    });

    return {
      url,
      expiresAt: new Date(Date.now() + GET_URL_TTL_SEC * 1000).toISOString(),
      mimeType: attachment.mimeType,
      originalName: attachment.originalName,
      sizeBytes: attachment.sizeBytes,
      contentDisposition: inline ? 'inline' : 'attachment',
    };
  }

  async cleanupPending(batchSize = 100): Promise<number> {
    const cutoff = new Date(Date.now() - PENDING_TTL_MS);
    const stale = await this.prisma.chatAttachment.findMany({
      where: { status: AttachmentStatus.PENDING, createdAt: { lt: cutoff } },
      take: batchSize,
      select: { id: true, storageKey: true },
    });
    let n = 0;
    for (const row of stale) {
      try {
        if (this.r2.isConfigured()) {
          await this.r2.delete(row.storageKey).catch(() => undefined);
        }
        await this.prisma.chatAttachment.update({
          where: { id: row.id },
          data: { status: AttachmentStatus.DELETED },
        });
        n += 1;
      } catch {
        // continue
      }
    }
    return n;
  }

  async deleteObjectForMessage(messageId: bigint): Promise<void> {
    const att = await this.prisma.chatAttachment.findFirst({ where: { messageId } });
    if (!att) return;
    await this.prisma.chatAttachment.update({
      where: { id: att.id },
      data: { status: AttachmentStatus.DELETED },
    });
    if (this.r2.isConfigured()) {
      void this.r2.delete(att.storageKey).catch(() => undefined);
    }
  }

  private fanout(
    chatId: string,
    message: Parameters<typeof messageDto>[0] & { attachment?: {
      id: string; mimeType: string; originalName: string; sizeBytes: number; status: string;
    } | null },
    sender: AuthUser,
    peerIds: bigint[],
    memberReads: Array<{ userId: bigint; onixId: string; username: string; lastReadAt: Date | null }>,
  ) {
    const messageByViewer = new Map<string, Record<string, unknown>>();
    for (const viewerId of [sender.id, ...peerIds]) {
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
  }

  private async rejectAndDelete(id: string, storageKey: string) {
    await this.prisma.chatAttachment.update({
      where: { id },
      data: { status: AttachmentStatus.REJECTED },
    });
    if (this.r2.isConfigured()) {
      void this.r2.delete(storageKey).catch(() => undefined);
    }
  }

  private async memberReads(chatId: string) {
    const memberRows = await this.prisma.chatMember.findMany({
      where: { chatId },
      include: { user: { select: { onixId: true, displayName: true, telegramNick: true } } },
    });
    return memberRows.map((m) => ({
      userId: m.userId,
      onixId: m.user.onixId,
      username: publicDisplayName(m.user.displayName, m.user.onixId),
      lastReadAt: m.lastReadAt,
    }));
  }
}
