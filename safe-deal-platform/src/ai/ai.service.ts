import { Injectable } from '@nestjs/common';
import { AuthUser } from '../common';
import { PrismaService } from '../prisma.service';
import { ConversationService } from './conversation.service';

@Injectable()
export class AIService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversation: ConversationService,
  ) {}

  ensureChat(user: AuthUser) {
    return this.conversation.ensureAiChat(user);
  }

  /** After USER message is stored — generate SYSTEM reply in the same AI chat. */
  async reply(user: AuthUser, chatId: string, userText: string) {
    const replyText = await this.conversation.handleUserMessage(user, chatId, userText);
    const created = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          chatId,
          kind: 'SYSTEM',
          senderId: null,
          text: replyText,
        },
      });
      await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
      return message;
    });
    return created;
  }
}
