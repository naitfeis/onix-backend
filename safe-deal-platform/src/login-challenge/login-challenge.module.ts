import { Module } from '@nestjs/common';
import { AuthV2Module } from '../auth-v2/auth-v2.module';
import { MfaModule } from '../mfa/mfa.module';
import { BotLoginController } from './bot-login.controller';
import { BotWebhookHandler } from './bot-webhook.handler';
import { LoginChallengeRepository } from './login-challenge.repository';
import { LoginChallengeService } from './login-challenge.service';

/**
 * ONIX Identity Platform — Website bot LoginChallenge (Phase D) + MFA callbacks (Slice 3).
 */
@Module({
  imports: [AuthV2Module, MfaModule],
  controllers: [BotLoginController, BotWebhookHandler],
  providers: [LoginChallengeRepository, LoginChallengeService],
  exports: [LoginChallengeService],
})
export class LoginChallengeModule {}
