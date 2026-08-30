import { Module } from '@nestjs/common';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { ConversationService } from './conversation.service';

@Module({
  controllers: [AIController],
  providers: [AIService, ConversationService],
  exports: [AIService, ConversationService],
})
export class AiModule {}
