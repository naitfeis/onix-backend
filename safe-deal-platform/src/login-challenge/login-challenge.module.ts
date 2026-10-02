import { Module } from '@nestjs/common';
import { AuthV2Module } from '../auth-v2/auth-v2.module';
import { MfaModule } from '../mfa/mfa.module';
import { BotLoginController } from './bot-login.controller';
import { BotWebhookHandler } from './bot-webhook.handler';
import { LoginChallengeRepository } from './login-challenge.repository';
import { LoginChallengeService } from './login-challenge.service';
import { PhoneCaptureService } from './phone-capture.service';

/**
 * ONIX Identity Platform — Website bot LoginChallenge (Phase D) + MFA callbacks (Slice 3).
 */
@Module({
  imports: [AuthV2Module, MfaModule],
  controllers: [BotLoginController, BotWebhookHandler],
  /**
   * RiskScoreService and SecurityLockService are NOT re-declared here: listing them as
   * providers again made Nest build a SECOND instance per module, so a marker armed by
   * one consumer could be invisible to another. Both come from AuthV2Module / RiskModule
   * imports, which keeps exactly one instance in the whole container.
   */
  providers: [
    LoginChallengeRepository,
    LoginChallengeService,
    PhoneCaptureService,
  ],
  exports: [LoginChallengeService],
})
export class LoginChallengeModule {}
