import { Controller, Get, Header, Headers, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common';
import { readRefreshTokenFromCookie, refreshCookieName } from './refresh-cookie';

/**
 * Cookie presence only — no DB, no refresh, no session lookup.
 * Used to isolate RU ERR_CONNECTION_RESET on /api/v2/auth/session vs cookie header.
 *
 * GET /api/session-probe
 */
@Public()
@Controller()
export class SessionProbeController {
  @Get('session-probe')
  @Header('Cache-Control', 'no-store')
  probe(
    @Req() req: Request,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const t0 = performance.now();
    const cookieHeader = headerString(headers, 'cookie') ?? '';
    const present = Boolean(readRefreshTokenFromCookie(cookieHeader));
    const dur = performance.now() - t0;
    const existing = res.getHeader('Server-Timing');
    const controllerMetric = `controller;dur=${dur.toFixed(1)}, db;dur=0`;
    if (typeof existing === 'string' && existing.length > 0) {
      res.setHeader('Server-Timing', `${existing}, ${controllerMetric}`);
    } else {
      res.setHeader('Server-Timing', controllerMetric);
    }
    res.setHeader('X-Response-Time', `${dur.toFixed(1)}ms`);
    return {
      cookiePresent: present,
      cookieName: refreshCookieName(),
      cookieHeaderLength: cookieHeader.length,
      path: req.originalUrl?.split('?')[0] ?? '/api/session-probe',
    };
  }
}

function headerString(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}
