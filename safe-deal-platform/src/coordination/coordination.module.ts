import { Global, Module } from '@nestjs/common';
import { resolveCoordinationConfig } from './coordination.config';
import { MemoryCoordinationAdapter } from './memory-coordination.adapter';
import { RedisCoordinationAdapter } from './redis-coordination.adapter';
import {
  COORDINATION_ADAPTER,
  COORDINATION_CONFIG,
  SharedCoordinationService,
} from './shared-coordination.service';
import { structuredLog } from '../observability/structured-logger';
import { DistributedRateLimiter } from '../rate-limit';

@Global()
@Module({
  providers: [
    {
      provide: COORDINATION_CONFIG,
      useFactory: resolveCoordinationConfig,
    },
    {
      provide: COORDINATION_ADAPTER,
      inject: [COORDINATION_CONFIG],
      useFactory: (config: ReturnType<typeof resolveCoordinationConfig>) => (
        config.backend === 'redis'
          ? new RedisCoordinationAdapter(
            config.redisUrl!,
            (error) => structuredLog.error('Redis coordination error', {}, error),
          )
          : new MemoryCoordinationAdapter()
      ),
    },
    SharedCoordinationService,
    DistributedRateLimiter,
  ],
  exports: [DistributedRateLimiter, SharedCoordinationService],
})
export class CoordinationModule {}
