import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard, AuthModule } from './auth.module';
import { AuthV2Module } from './auth-v2/auth-v2.module';
import { ApiExceptionFilter } from './common';
import { CoordinationModule } from './coordination/coordination.module';
import { DatabaseModule } from './database.module';
import { AiModule } from './ai/ai.module';
import { EngagementModule } from './engagement.module';
import { EscrowModule } from './escrow.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { MarketplaceModule } from './marketplace.module';
import { ObservabilityModule } from './observability/observability.module';
import { OperationsModule } from './operations.module';
import { ProfilesModule } from './profiles.module';
import { SocialModule } from './social.module';
import { SupportModule } from './support.module';
import { EconomyModule } from './economy/economy.module';

import { AvatarsModule } from './avatars/avatars.module';
import { AdminModule } from './admin/admin.module';
import { LoginChallengeModule } from './login-challenge/login-challenge.module';
import { MfaModule } from './mfa/mfa.module';
import { RealtimeModule } from './realtime/realtime.module';
import { spaServeModules } from './spa-static';

@Module({
  imports: [
    ...spaServeModules(),
    CoordinationModule,
    DatabaseModule,
    ObservabilityModule,
    IdempotencyModule,
    RealtimeModule,
    AvatarsModule,
    AuthModule, AuthV2Module, LoginChallengeModule, MfaModule, AdminModule,
    ProfilesModule, MarketplaceModule, SocialModule,
    EscrowModule, EngagementModule, AiModule, SupportModule, OperationsModule, EconomyModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
