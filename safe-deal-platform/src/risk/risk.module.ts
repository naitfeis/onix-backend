import { Module } from '@nestjs/common';
import { MfaModule } from '../mfa/mfa.module';
import { RiskEngineService } from './risk-engine.service';

@Module({
  imports: [MfaModule],
  providers: [RiskEngineService],
  exports: [RiskEngineService],
})
export class RiskModule {}
