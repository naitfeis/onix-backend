import { Controller, Get, Header, Headers, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common';
import { readRefreshTokenFromCookie, refreshCookieName } from './refresh-cookie';

/**
 * Cookie presence probe for Website Auth V2 (RU / no-VPN debug).
 * Never returns token values.
 *
 * GET /api/debug/session
 */
@Public()
@Controller('debug')
export class DebugSessionController {
  @Get('session')
  @Header('Cache-Control', 'no-store')
  session(
    @Req() req: Request,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const cookieHeader = headerString(headers, 'cookie');
    const secure = process.env.AUTH_COOKIE_SECURE !== 'false';
    return {
      cookiePresent: Boolean(readRefreshTokenFromCookie(cookieHeader)),
      host: headerString(headers, 'host') ?? req.hostname ?? null,
      origin: headerString(headers, 'origin') ?? null,
      userAgent: headerString(headers, 'user-agent') ?? null,
      secure,
      sameSite: 'Lax' as const,
      // Extra ops fields (no secrets):
      cookieName: refreshCookieName(),
      httpOnly: true,
      path: '/',
      domain: null,
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
