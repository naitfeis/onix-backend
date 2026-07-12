import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, AuthModule } from './auth.module';
import { DatabaseModule } from './database.module';
import { EngagementModule } from './engagement.module';
import { EscrowModule } from './escrow.module';
import { MarketplaceModule } from './marketplace.module';
import { OperationsModule } from './operations.module';
import { ProfilesModule } from './profiles.module';
import { SocialModule } from './social.module';

@Module({
  imports: [
    DatabaseModule, AuthModule, ProfilesModule, MarketplaceModule, SocialModule,
    EscrowModule, EngagementModule, OperationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}