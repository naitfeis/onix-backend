import { Module } from '@nestjs/common';
import { AuthV2Module } from '../auth-v2/auth-v2.module';
import { BotLoginController } from './bot-login.controller';
import { BotWebhookHandler } from './bot-webhook.handler';
import { LoginChallengeRepository } from './login-challenge.repository';
import { LoginChallengeService } from './login-challenge.service';

/**
 * ONIX Identity Platform — Website bot LoginChallenge (Phase D).
 * Depends on AuthOrchestrator only (not SessionService directly).
 * Prisma comes from @Global DatabaseModule (AppModule) — do not re-import.
 */
@Module({
  imports: [AuthV2Module],
  controllers: [BotLoginController, BotWebhookHandler],
  providers: [LoginChallengeRepository, LoginChallengeService],
  exports: [LoginChallengeService],
})
export class LoginChallengeModule {}
