import { Module } from '@nestjs/common';
import { EconomyModule } from '../economy/economy.module';
import { MarketplaceModule } from '../marketplace.module';
import { MfaModule } from '../mfa/mfa.module';
import { RiskModule } from '../risk/risk.module';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { ConversationService } from './conversation.service';
import { ProductCreationService } from './product-creation.service';

@Module({
  imports: [MarketplaceModule, EconomyModule, RiskModule, MfaModule],
  controllers: [AIController],
  providers: [AIService, ConversationService, ProductCreationService],
  exports: [AIService, ConversationService],
})
export class AiModule {}
