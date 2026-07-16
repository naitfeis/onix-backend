import { Controller, Get, Header, Headers, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common';
import { readRefreshTokenFromCookie, refreshCookieName } from './refresh-cookie';

/**
 * Temporary session/cookie probe for RU WebView debugging.
 * Never returns token values.
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
      cookieName: refreshCookieName(),
      origin: headerString(headers, 'origin') ?? null,
      userAgent: headerString(headers, 'user-agent') ?? null,
      host: headerString(headers, 'host') ?? req.hostname ?? null,
      secure,
      sameSite: 'Lax' as const,
      path: '/',
      httpOnly: true,
      domain: null,
      note: '__Host- refresh is host-only on the API request host (www same-origin /api). Not shared with api.onixtg.shop.',
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
