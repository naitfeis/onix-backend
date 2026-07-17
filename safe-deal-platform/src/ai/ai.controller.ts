import { Controller, Get, Header } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common';
import { AIService } from './ai.service';

@Controller('ai')
export class AIController {
  constructor(private readonly ai: AIService) {}

  /** Ensures the pinned ONIX AI system chat exists for the current user. */
  @Get('chat')
  @Header('Cache-Control', 'private, no-store')
  async chat(@CurrentUser() user: AuthUser) {
    const chat = await this.ai.ensureChat(user);
    return {
      id: chat.id,
      kind: 'AI' as const,
      title: 'ONIX AI',
    };
  }
}
