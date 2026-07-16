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
 * Logs AUTH_SESSION_REQUEST_START even if the handler never runs
 * (client abort, proxy reset after accept, etc.).
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
  const cookieHeader = headerString(req, 'cookie') ?? '';
  const cookieLength = cookieHeader.length;
  const host = headerString(req, 'host') ?? null;
  const origin = headerString(req, 'origin') ?? null;
  const userAgent = headerString(req, 'user-agent') ?? null;

  if (isAuthSession) {
    logger.log(
      `AUTH_SESSION_REQUEST_START requestId=${requestId} `
      + `host=${host ?? '-'} origin=${origin ?? '-'} `
      + `cookieLength=${cookieLength} userAgent=${userAgent ?? '-'}`,
    );
  } else {
    logger.log(
      `AUTH_PATH_PROBE_START path=${path} requestId=${requestId} `
      + `cookieLength=${cookieLength}`,
    );
  }

  const existing = res.getHeader('Server-Timing');
  const mwMetric = `middleware;dur=0.1`;
  if (typeof existing === 'string' && existing.length > 0) {
    res.setHeader('Server-Timing', `${existing}, ${mwMetric}`);
  } else {
    res.setHeader('Server-Timing', mwMetric);
  }

  res.on('finish', () => {
    const totalMs = performance.now() - started;
    if (isAuthSession) {
      logger.log(
        `AUTH_SESSION_REQUEST_END requestId=${requestId} `
        + `status=${res.statusCode} dur=${totalMs.toFixed(1)}ms cookieLength=${cookieLength}`,
      );
    }
  });

  next();
}
