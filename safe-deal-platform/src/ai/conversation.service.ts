import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthUser } from '../common';
import { FAQ_ITEMS, faqAnswer, matchFaq, TICKET_HINT } from './help-replies';
import { messageDto } from '../response';
import { RealtimeBus } from '../realtime/realtime-bus.service';

const AI_TITLE = 'ONIX AI';

const SENDER_SELECT = {
  id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true, isAdmin: true, isSupport: true, platformStatus: true,
} as const;

@Injectable()
export class AiConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeBus,
  ) {}

  async ensureChat(user: AuthUser) {
    const existing = await this.prisma.chat.findFirst({
      where: { kind: 'AI', members: { some: { userId: user.id } } },
      select: { id: true, title: true, kind: true },
    });
    if (existing) {
      if (existing.title !== AI_TITLE) {
        await this.prisma.chat.update({ where: { id: existing.id }, data: { title: AI_TITLE } });
      }
      return { id: existing.id, kind: 'AI' as const, title: AI_TITLE, unreadCount: 0, faqs: FAQ_ITEMS };
    }
    const chat = await this.prisma.chat.create({
      data: {
        kind: 'AI',
        title: AI_TITLE,
        members: { create: { userId: user.id } },
        messages: {
          create: {
            kind: 'SYSTEM',
            senderId: null,
            text: `Я помогу с правилами ONIX и передам тикет поддержке.\n\n${TICKET_HINT}`,
          },
        },
      },
      select: { id: true },
    });
    return { id: chat.id, kind: 'AI' as const, title: AI_TITLE, unreadCount: 0, faqs: FAQ_ITEMS };
  }

  async reply(user: AuthUser, text: string, faqId?: string) {
    const chat = await this.ensureChat(user);
    const body = text.trim();
    if (!body && !faqId) throw new BadRequestException('Напишите вопрос или выберите подсказку.');

    const ticket = /^(тикет|жалоба|поддержка)\b/i.test(body) || faqId === 'support_ticket' && body.length > 20;
    if (ticket && body.length >= 8) {
      await this.prisma.userReport.create({
        data: {
          reporterId: user.id,
          targetId: user.id,
          reason: 'OTHER',
          comment: body.slice(0, 1000),
          kind: 'AI_SUPPORT',
        },
      });
    }

    const answer = faqId
      ? (faqAnswer(faqId) ?? TICKET_HINT)
      : (matchFaq(body) ?? (
        ticket
          ? 'Тикет отправлен администраторам. Обычно отвечаем в уведомлениях.'
          : `Не нашёл точный ответ.\n\n${TICKET_HINT}`
      ));

    const userMessage = body
      ? await this.prisma.message.create({
        data: { chatId: chat.id, kind: 'USER', senderId: user.id, text: body.slice(0, 2000) },
        include: { sender: { select: SENDER_SELECT } },
      })
      : null;
    const aiMessage = await this.prisma.message.create({
      data: { chatId: chat.id, kind: 'SYSTEM', senderId: null, text: answer },
    });
    await this.prisma.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
    if (userMessage) this.publishAiMessage(chat.id, userMessage, user.id, user.id);
    this.publishAiMessage(chat.id, { ...aiMessage, sender: null }, user.id, 0n);
    return { chatId: chat.id, answer, faqs: FAQ_ITEMS, ticketCreated: Boolean(ticket && body.length >= 8) };
  }

  private publishAiMessage(
    chatId: string,
    message: Parameters<typeof messageDto>[0],
    viewerId: bigint,
    senderId: bigint,
  ): void {
    const dto = messageDto(message, viewerId) as unknown as Record<string, unknown>;
    this.realtime.publish({
      kind: 'chat.message',
      chatId,
      recipientUserIds: [viewerId],
      messageByViewer: new Map([[viewerId.toString(), dto]]),
      senderId,
    });
  }
}
