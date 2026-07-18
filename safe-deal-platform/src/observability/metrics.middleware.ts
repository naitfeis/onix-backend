import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Records HTTP request metrics after response finishes.
 * Route label uses path without query; keep cardinality low.
 */
export function createMetricsMiddleware(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const path = (req.route?.path as string | undefined)
        ?? req.path
        ?? req.url?.split('?')[0]
        ?? 'unknown';
      // Normalize numeric ids to keep Prometheus cardinality bounded.
      const route = String(path)
        .replace(/\/\d+/g, '/:id')
        .replace(/\/ONIX-[A-Z0-9]+/gi, '/:onixId');
      metrics.recordHttp(req.method, route, res.statusCode, durationMs);
    });
    next();
  };
}
