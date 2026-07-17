import { Module } from '@nestjs/common';
import { MarketplaceModule } from '../marketplace.module';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { ConversationService } from './conversation.service';
import { ProductCreationService } from './product-creation.service';

@Module({
  imports: [MarketplaceModule],
  controllers: [AIController],
  providers: [AIService, ConversationService, ProductCreationService],
  exports: [AIService, ConversationService],
})
export class AiModule {}
