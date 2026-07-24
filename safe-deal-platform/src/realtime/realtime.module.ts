import { Global, Module } from '@nestjs/common';
import { AuthV2Module } from '../auth-v2/auth-v2.module';
import { DatabaseModule } from '../database.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeBus } from './realtime-bus.service';
import { RealtimeHubService } from './realtime-hub.service';

/** Global so Chat/Escrow/Profiles share one in-process bus with the hub. */
@Global()
@Module({
  imports: [DatabaseModule, AuthV2Module],
  providers: [RealtimeBus, RealtimeAuthService, RealtimeHubService],
  exports: [RealtimeBus, RealtimeHubService],
})
export class RealtimeModule {}
