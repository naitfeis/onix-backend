import { Module } from '@nestjs/common';
import { AuthV2Module } from '../auth-v2/auth-v2.module';
import { EconomyModule } from '../economy/economy.module';
import { FraudWatchService } from './fraud-watch.service';

/**
 * Own module so the optional RiskScoreService dependency is guaranteed to resolve.
 * Registering FraudWatchService where RiskScoreService is not provided would inject
 * `undefined` — and because the call is optional-chained, the registration filter would
 * silently stop arming with no error anywhere.
 */
@Module({
  imports: [AuthV2Module, EconomyModule],
  providers: [FraudWatchService],
  exports: [FraudWatchService],
})
export class FraudWatchModule {}