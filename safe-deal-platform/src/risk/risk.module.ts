import { Module } from '@nestjs/common';
import { MfaModule } from '../mfa/mfa.module';
import { RiskEngineService } from './risk-engine.service';
import { SecurityLockService } from './security-lock.service';

@Module({
  imports: [MfaModule],
  providers: [RiskEngineService, SecurityLockService],
  exports: [RiskEngineService, SecurityLockService],
})
export class RiskModule {}
