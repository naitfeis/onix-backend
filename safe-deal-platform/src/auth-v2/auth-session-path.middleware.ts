import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('AuthSessionPath');

function headerString(req: Request, name: string): string | undefined {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === 'string' ? raw : undefined;
}

function pathOf(req: Request): string {
  const raw = req.originalUrl ?? req.url ?? '';
  return raw.split('?')[0] ?? '';
}

/**
 * Early path probe — runs before Nest controllers / AuthGuard.
 * Production: silent on happy path; warn only on slow/error finishes.
 */
export function authSessionPathMiddleware(req: Request, res: Response, next: NextFunction): void {
  const path = pathOf(req);
  const isAuthSession = path === '/api/v2/auth/session' || path.endsWith('/v2/auth/session');
  const isSessionProbe = path === '/api/session-probe' || path.endsWith('/session-probe');
  const isRouteDebug = path === '/api/health/route-debug' || path.endsWith('/health/route-debug');

  if (!isAuthSession && !isSessionProbe && !isRouteDebug) {
    next();
    return;
  }

  const started = performance.now();
  const requestId = headerString(req, 'x-request-id') ?? 'missing';

  const existing = res.getHeader('Server-Timing');
  const mwMetric = 'middleware;dur=0.1';
  if (typeof existing === 'string' && existing.length > 0) {
    res.setHeader('Server-Timing', `${existing}, ${mwMetric}`);
  } else {
    res.setHeader('Server-Timing', mwMetric);
  }

  res.on('finish', () => {
    const totalMs = performance.now() - started;
    // 401 on session probe = guest / expired — not an ops incident.
    const unexpectedFail = res.statusCode >= 500
      || (res.statusCode >= 400 && res.statusCode !== 401);
    const slow = totalMs >= 1000;
    if (!unexpectedFail && !slow) return;
    logger.warn(
      `${isAuthSession ? 'AUTH_SESSION' : 'AUTH_PATH'} `
      + `path=${path} requestId=${requestId} status=${res.statusCode} dur=${totalMs.toFixed(0)}ms`,
    );
  });

  next();
}
