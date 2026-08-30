import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { AiController } from './ai.controller';
import { AiConversationService } from './conversation.service';

@Module({
  imports: [RealtimeModule],
  controllers: [AiController],
  providers: [AiConversationService],
  exports: [AiConversationService],
})
export class AiModule {}
