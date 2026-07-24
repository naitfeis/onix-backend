import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { ChatAttachmentsController } from './chat-attachments.controller';
import { ChatAttachmentsService } from './chat-attachments.service';
import { R2StorageService } from './r2-storage.service';

@Module({
  imports: [RealtimeModule],
  controllers: [ChatAttachmentsController],
  providers: [R2StorageService, ChatAttachmentsService],
  exports: [ChatAttachmentsService, R2StorageService],
})
export class ChatAttachmentsModule {}
