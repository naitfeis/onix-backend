import { Controller, ForbiddenException, Get, Header, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common';
import { MetricsService } from './metrics.service';
import { ErrorTrackingService } from './error-tracking.service';

function assertOpsToken(req: Request, queryToken?: string): void {
  const expected = (process.env.OPS_METRICS_TOKEN ?? '').trim();
  if (!expected) return; // open in local/dev when unset
  const header = req.headers['x-ops-token'];
  const provided = (typeof header === 'string' ? header : queryToken ?? '').trim();
  if (provided !== expected) throw new ForbiddenException('Invalid ops token.');
}

@Controller()
export class ObservabilityController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly errors: ErrorTrackingService,
  ) {}

  /** Prometheus scrape endpoint. */
  @Public()
  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  metricsText(@Req() req: Request, @Res() res: Response, @Query('token') token?: string): void {
    assertOpsToken(req, token);
    res.type('text/plain; version=0.0.4; charset=utf-8').send(this.metrics.toPrometheus());
  }

  /** JSON snapshot for ops dashboards / alert drills. */
  @Public()
  @Get('metrics/json')
  @Header('Cache-Control', 'no-store')
  metricsJson(@Req() req: Request, @Query('token') token?: string) {
    assertOpsToken(req, token);
    return this.metrics.snapshot();
  }

  /** Recent captured errors (redacted) — useful for staging drills. */
  @Public()
  @Get('ops/errors/recent')
  recentErrors(@Req() req: Request, @Query('token') token?: string) {
    assertOpsToken(req, token);
    return { errors: this.errors.recentErrors().slice(-20) };
  }
}
