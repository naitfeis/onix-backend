import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiConversationService } from './conversation.service';

@Module({
  controllers: [AiController],
  providers: [AiConversationService],
  exports: [AiConversationService],
})
export class AiModule {}
