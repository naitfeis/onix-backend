import { Injectable } from '@nestjs/common';
import { ChatAttachmentsService } from '../../chat-attachments/chat-attachments.service';

@Injectable()
export class ChatAttachmentCleanupJob {
  constructor(private readonly attachments: ChatAttachmentsService) {}

  async run(batchSize = 100): Promise<number> {
    return this.attachments.cleanupPending(batchSize);
  }
}
