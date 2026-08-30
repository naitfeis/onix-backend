import { Global, Module } from '@nestjs/common';
import { AuthV2Module } from '../auth-v2/auth-v2.module';
import { DatabaseModule } from '../database.module';
import { CoordinationModule } from '../coordination/coordination.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeBus } from './realtime-bus.service';
import { RealtimeHubService } from './realtime-hub.service';

/** Global so domain modules share one local hub backed by shared pub/sub. */
@Global()
@Module({
  imports: [CoordinationModule, DatabaseModule, AuthV2Module],
  providers: [RealtimeBus, RealtimeAuthService, RealtimeHubService],
  exports: [RealtimeBus, RealtimeHubService],
})
export class RealtimeModule {}
