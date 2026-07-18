import { Global, Module } from '@nestjs/common';
import { AlertingService } from './alerting.service';
import { ErrorTrackingService } from './error-tracking.service';
import { MetricsService } from './metrics.service';
import { ObservabilityController } from './observability.controller';

@Global()
@Module({
  controllers: [ObservabilityController],
  providers: [MetricsService, ErrorTrackingService, AlertingService],
  exports: [MetricsService, ErrorTrackingService, AlertingService],
})
export class ObservabilityModule {}
