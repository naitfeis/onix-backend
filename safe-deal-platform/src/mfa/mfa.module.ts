import { Module } from '@nestjs/common';
import { MfaController } from './mfa.controller';
import { MfaStepUpService } from './mfa-step-up.service';

@Module({
  controllers: [MfaController],
  providers: [MfaStepUpService],
  exports: [MfaStepUpService],
})
export class MfaModule {}
