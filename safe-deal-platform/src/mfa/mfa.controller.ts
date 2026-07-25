import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import { MfaStepUpService } from './mfa-step-up.service';

@Controller('v2/auth/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaStepUpService) {}

  /** Poll step-up challenge after Telegram confirm. */
  @Get('status')
  status(
    @CurrentUser() user: AuthUser,
    @Query('challengeId') challengeId: string,
  ) {
    if (!challengeId?.trim()) {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_INVALID', 'challengeId required.');
    }
    return this.mfa.getStatusForUser(challengeId.trim(), user.id);
  }
}
