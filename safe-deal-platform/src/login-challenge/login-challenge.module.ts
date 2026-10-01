import { Module } from '@nestjs/common';
import { AuthV2Module } from '../auth-v2/auth-v2.module';
import { MfaModule } from '../mfa/mfa.module';
import { RiskScoreService } from '../risk-score.service';
import { SecurityLockService } from '../risk/security-lock.service';
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
  providers: [
    LoginChallengeRepository,
    LoginChallengeService,
    PhoneCaptureService,
    RiskScoreService,
    SecurityLockService,
  ],
  exports: [LoginChallengeService],
})
export class LoginChallengeModule {}
