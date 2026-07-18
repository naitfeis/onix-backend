import type { NextFunction, Request, Response } from 'express';
import { structuredLog } from './observability/structured-logger';

type AuthedRequest = Request & {
  user?: { id?: bigint | string };
};

/**
 * Access log + Server-Timing / X-Response-Time.
 * Emits: requestId, userId, route, status, duration — never secrets.
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

    const requestId = (req.headers['x-request-id'] as string | undefined) ?? undefined;
    const userId = (req as AuthedRequest).user?.id?.toString();
    const route = `${req.method} ${(req.originalUrl ?? req.url ?? '').split('?')[0]}`;
    const fields = {
      requestId,
      userId,
      route,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
    };
    if (durationMs >= 1000 || res.statusCode >= 500) {
      structuredLog.warn('http_request', fields);
    } else {
      structuredLog.info('http_request', fields);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalEnd as any)(...args);
  };

  next();
}
