import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('RequestTiming');

/**
 * Sets Server-Timing / X-Response-Time and warns on slow handlers (≥800ms).
 * Appends `app` metric — does not wipe controller-provided Server-Timing phases.
 */
export function requestTimingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  const originalEnd = res.end.bind(res);

  // Patch end so duration is known before headers flush.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).end = (...args: unknown[]) => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (!res.headersSent) {
      const existing = res.getHeader('Server-Timing');
      const appMetric = `app;dur=${durationMs.toFixed(1)}`;
      if (typeof existing === 'string' && existing.length > 0) {
        res.setHeader('Server-Timing', `${existing}, ${appMetric}`);
      } else if (Array.isArray(existing) && existing.length > 0) {
        res.setHeader('Server-Timing', `${existing.join(', ')}, ${appMetric}`);
      } else {
        res.setHeader('Server-Timing', appMetric);
      }
      if (!res.getHeader('X-Response-Time')) {
        res.setHeader('X-Response-Time', `${durationMs.toFixed(1)}ms`);
      }
    }
    if (durationMs >= 800) {
      logger.warn(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(0)}ms`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalEnd as any)(...args);
  };

  next();
}
