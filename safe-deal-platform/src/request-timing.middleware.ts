import type { NextFunction, Request, Response } from 'express';
import { structuredLog } from './observability/structured-logger';

type AuthedRequest = Request & {
  user?: { id?: bigint | string };
};

export function shouldQuietHttpAccessLog(input: {
  method: string;
  pathOnly: string;
  status: number;
  durationMs: number;
}): boolean {
  const method = input.method.toUpperCase();
  const pathOnly = input.pathOnly;
  const { status, durationMs } = input;
  if (durationMs >= 1500 || status >= 500) return false;
  const isHealthProbe = pathOnly === '/api/health/live'
    || pathOnly === '/api/health/ready'
    || pathOnly === '/api/health'
    || (pathOnly === '/' && method === 'HEAD');
  if (isHealthProbe && status < 500) return true;
  if (method === 'GET' && status < 400 && (
    pathOnly === '/api/session-probe'
    || pathOnly === '/api/v2/auth/session'
    || pathOnly === '/api/realtime'
    || pathOnly.startsWith('/api/notifications')
    || pathOnly.startsWith('/api/avatars/')
    || pathOnly.startsWith('/api/chats')
  )) {
    return true;
  }
  if (method === 'POST' && status < 400 && pathOnly === '/api/users/me/presence') {
    return true;
  }
  return false;
}

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
    const pathOnly = (req.originalUrl ?? req.url ?? '').split('?')[0] || '';
    const route = `${req.method} ${pathOnly}`;
    const fields = {
      requestId,
      userId,
      route,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
    };
    if (shouldQuietHttpAccessLog({
      method: req.method,
      pathOnly,
      status: res.statusCode,
      durationMs,
    })) {
      return (originalEnd as any)(...args);
    }
    // Skip access log for empty scanner 404s (middleware already ended).
    if (res.statusCode === 404 && (route.endsWith(' /.env') || route.includes(' /.git'))) {
      return (originalEnd as any)(...args);
    }
    // Fast OK / expected 401 guest stay info; warn only on slow or 5xx. Silent 404.
    if (durationMs >= 2000 || res.statusCode >= 500) {
      structuredLog.warn('http_request', fields);
    } else if (res.statusCode !== 404) {
      structuredLog.info('http_request', fields);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalEnd as any)(...args);
  };

  next();
}
