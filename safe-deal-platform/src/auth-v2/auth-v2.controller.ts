import {
  Body, Controller, Delete, Get, Header, Headers, Logger, Param, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common';
import { AuthOrchestrator } from './auth-orchestrator.service';
import { AuthPlatformError } from './auth-errors';
import { GoogleLoginDto, LinkTelegramDto, LoginDto, RefreshDto } from './auth-v2.dto';
import { AuthV2Guard, type AuthV2RequestUser } from './auth-v2.guards';
import {
  assertCsrfHeader,
  assertGoogleGsiCsrf,
  buildClearRefreshCookieHeaders,
  buildRefreshCookieHeader,
  readRefreshTokenFromCookie,
} from './refresh-cookie';
import { SessionService } from './session.service';
import { DistributedRateLimiter } from '../rate-limit';
import { resolveClientIp } from '../http/client-ip';

/**
 * Website auth API. Marked @Public so legacy APP AuthGuard skips.
 * Protected routes use AuthV2Guard (Ed25519 + session validation).
 */
@Public()
@Controller('v2/auth')
export class AuthV2Controller {
  private readonly logger = new Logger(AuthV2Controller.name);

  constructor(
    private readonly orchestrator: AuthOrchestrator,
    private readonly sessions: SessionService,
    private readonly rateLimit: DistributedRateLimiter,
  ) {}

  @Post('login')
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() body: LoginDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { ip?: string; headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientIp = resolveClientIp({ ip: req.ip, headers: req.headers ?? headers, socket: req.socket });
    await this.rateLimit.assert(`auth:v2:login:${clientIp ?? 'unknown'}`, 20, 60_000);
    const result = await this.orchestrator.loginWithTelegram({
      telegram: body.telegram,
      rememberMe: body.rememberMe,
      device: {
        ...body.device,
        userAgent: body.device?.userAgent ?? headerString(headers, 'user-agent'),
        // Never trust client-supplied device.ipAddress.
        ipAddress: clientIp ?? undefined,
      },
    });

    res.setHeader('Set-Cookie', buildRefreshCookieHeader(result.refreshToken, result.refreshMaxAgeSeconds));

    return {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshMaxAgeSeconds: result.refreshMaxAgeSeconds,
      trustedDevice: result.trustedDevice,
      user: {
        id: result.user.id.toString(),
        onixId: result.user.onixId,
        isAdmin: result.user.isAdmin,
        sessionVersion: result.user.sessionVersion,
        permissionVersion: result.user.permissionVersion,
      },
      session: {
        id: result.session.id,
        deviceName: result.session.deviceName,
        browser: result.session.browser,
        os: result.session.os,
        country: result.session.country,
        lastSeenAt: result.session.lastSeenAt.toISOString(),
        createdAt: result.session.createdAt.toISOString(),
        expiresAt: result.session.absoluteExpiresAt.toISOString(),
        rememberMe: result.session.rememberMe,
      },
    };
  }

  @Post('google')
  @Header('Cache-Control', 'no-store')
  async loginGoogle(
    @Body() body: GoogleLoginDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { ip?: string; headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientIp = resolveClientIp({ ip: req.ip, headers: req.headers ?? headers, socket: req.socket });
    await this.rateLimit.assert(`auth:v2:google:${clientIp ?? 'unknown'}`, 20, 60_000);
    const result = await this.orchestrator.loginWithGoogle({
      idToken: body.idToken,
      rememberMe: body.rememberMe,
      device: {
        ...body.device,
        userAgent: body.device?.userAgent ?? headerString(headers, 'user-agent'),
        ipAddress: clientIp ?? undefined,
      },
    });
    res.setHeader('Set-Cookie', buildRefreshCookieHeader(result.refreshToken, result.refreshMaxAgeSeconds));
    return {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshMaxAgeSeconds: result.refreshMaxAgeSeconds,
      trustedDevice: result.trustedDevice,
      user: {
        id: result.user.id.toString(),
        onixId: result.user.onixId,
        isAdmin: result.user.isAdmin,
        sessionVersion: result.user.sessionVersion,
        permissionVersion: result.user.permissionVersion,
      },
      session: {
        id: result.session.id,
        deviceName: result.session.deviceName,
        browser: result.session.browser,
        os: result.session.os,
        country: result.session.country,
        lastSeenAt: result.session.lastSeenAt.toISOString(),
        createdAt: result.session.createdAt.toISOString(),
        expiresAt: result.session.absoluteExpiresAt.toISOString(),
        rememberMe: result.session.rememberMe,
      },
    };
  }

  /**
   * GIS redirect return. Google POSTs credential + g_csrf_token (not JSON).
   * Sets the refresh cookie and 303s to `/` so the SPA session probe picks it up.
   * Add this URL under Authorized redirect URIs in Google Cloud Console.
   */
  @Post('google/callback')
  @Header('Cache-Control', 'no-store')
  async loginGoogleRedirect(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: {
      ip?: string;
      body?: Record<string, unknown>;
      headers: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
    },
    @Res() res: Response,
  ) {
    try {
      const clientIp = resolveClientIp({ ip: req.ip, headers: req.headers ?? headers, socket: req.socket });
      await this.rateLimit.assert(`auth:v2:google:${clientIp ?? 'unknown'}`, 20, 60_000);
      const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
      const csrf = typeof req.body?.g_csrf_token === 'string' ? req.body.g_csrf_token : undefined;
      if (!credential) {
        throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Google token is invalid.');
      }
      assertGoogleGsiCsrf(headerString(headers, 'cookie'), csrf);
      const result = await this.orchestrator.loginWithGoogle({
        idToken: credential,
        rememberMe: true,
        device: {
          userAgent: headerString(headers, 'user-agent'),
          ipAddress: clientIp ?? undefined,
        },
      });
      res.setHeader('Set-Cookie', buildRefreshCookieHeader(result.refreshToken, result.refreshMaxAgeSeconds));
      res.redirect(303, '/');
    } catch (error) {
      this.logger.warn(JSON.stringify({
        msg: 'auth_v2_google_redirect_failed',
        code: error instanceof AuthPlatformError ? error.code : 'AUTH_INTERNAL',
      }));
      res.redirect(303, '/?auth_error=google');
    }
  }

  /** Public Client ID for Google GIS. Safe to expose; Amvera cannot bake VITE_* at build. */
  @Get('public-config')
  @Header('Cache-Control', 'no-store')
  publicConfig() {
    const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
    const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI?.trim()
      || (process.env.NODE_ENV === 'production' ? 'https://www.onixtg.shop/auth/google' : null);
    return { googleClientId, googleRedirectUri };
  }

  @UseGuards(AuthV2Guard)
  @Post('link/telegram')
  @Header('Cache-Control', 'no-store')
  linkTelegram(
    @Req() req: { user: AuthV2RequestUser },
    @Body() body: LinkTelegramDto,
  ) {
    return this.orchestrator.linkTelegramToCurrentUser(req.user.id, body.telegram);
  }

  @UseGuards(AuthV2Guard)
  @Post('link/google')
  @Header('Cache-Control', 'no-store')
  linkGoogle(
    @Req() req: { user: AuthV2RequestUser },
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: GoogleLoginDto,
  ) {
    assertCsrfHeader(headers);
    return this.orchestrator.linkGoogleToCurrentUser(req.user.id, body.idToken);
  }

  @Post('refresh')
  @Header('Cache-Control', 'no-store')
  async refresh(
    @Body() body: RefreshDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const t0 = process.hrtime.bigint();
    const clientIp = resolveClientIp({ ip: req.ip, headers: req.headers ?? headers, socket: req.socket });
    await this.rateLimit.assert(`auth:v2:refresh:${clientIp ?? 'unknown'}`, 60, 60_000);
    assertCsrfHeader(headers);
    const refreshToken = readRefreshTokenFromCookie(headerString(headers, 'cookie'));
    if (!refreshToken) {
      throw new AuthPlatformError('AUTH_REFRESH_MISSING', 'Refresh cookie is missing.');
    }

    const timing = { dbMs: 0, tokenMs: 0 };
    const result = await this.orchestrator.refresh(refreshToken, {
      ...body.device,
      userAgent: body.device?.userAgent ?? headerString(headers, 'user-agent'),
      ipAddress: clientIp ?? undefined,
    }, timing);

    res.setHeader('Set-Cookie', buildRefreshCookieHeader(result.refreshToken, result.refreshMaxAgeSeconds));

    const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
    res.setHeader(
      'Server-Timing',
      [
        `refresh-total;dur=${totalMs.toFixed(1)}`,
        `refresh-db;dur=${timing.dbMs.toFixed(1)}`,
        `refresh-token;dur=${timing.tokenMs.toFixed(1)}`,
      ].join(', '),
    );
    res.setHeader('X-Response-Time', `${totalMs.toFixed(1)}ms`);

    return {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: result.user.id.toString(),
        onixId: result.user.onixId,
        sessionVersion: result.user.sessionVersion,
        permissionVersion: result.user.permissionVersion,
      },
      session: {
        id: result.session.id,
        refreshGeneration: result.session.refreshGeneration,
      },
    };
  }

  /**
   * Cookie-only session status (Website persistent login).
   * No Bearer, no Telegram, no refresh rotation, no permissions / profile / orders.
   * Path: cookie → hash → session+user lookup → 200/401.
   */
  @Get('session')
  @Header('Cache-Control', 'no-store')
  async session(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { ip?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.rateLimit.assert(`auth:v2:session:${req.ip ?? 'unknown'}`, 90, 60_000);
    const t0 = performance.now();

    const tCookie = performance.now();
    const refreshToken = readRefreshTokenFromCookie(headerString(headers, 'cookie'));
    const cookieParseMs = performance.now() - tCookie;

    if (!refreshToken) {
      const totalMs = performance.now() - t0;
      const existing = res.getHeader('Server-Timing');
      const phases = [
        'edge;dur=0',
        'middleware;dur=0',
        `controller;dur=${totalMs.toFixed(1)}`,
        'db;dur=0',
        `cookie-parse;dur=${cookieParseMs.toFixed(1)}`,
      ].join(', ');
      res.setHeader(
        'Server-Timing',
        typeof existing === 'string' && existing.length > 0 ? `${existing}, ${phases}` : phases,
      );
      res.setHeader('X-Response-Time', `${totalMs.toFixed(1)}ms`);
      // Guest without cookie is normal — do not log.
      throw new AuthPlatformError('AUTH_REFRESH_MISSING', 'Refresh cookie is missing.');
    }

    const phase = {
      hashMs: 0,
      sessionLookupMs: 0,
      userLookupMs: 0,
    };
    const { user, session } = await this.sessions.getSessionByRefreshToken(refreshToken, phase);
    const totalMs = performance.now() - t0;
    const controllerMs = totalMs;
    const dbMs = phase.sessionLookupMs + phase.userLookupMs;
    const existing = res.getHeader('Server-Timing');
    const phases = [
      'edge;dur=0',
      'middleware;dur=0',
      `controller;dur=${controllerMs.toFixed(1)}`,
      `db;dur=${dbMs.toFixed(1)}`,
      `cookie-parse;dur=${cookieParseMs.toFixed(1)}`,
      `hash;dur=${phase.hashMs.toFixed(1)}`,
      `session-lookup;dur=${phase.sessionLookupMs.toFixed(1)}`,
      `user-lookup;dur=${phase.userLookupMs.toFixed(1)}`,
    ].join(', ');
    res.setHeader(
      'Server-Timing',
      typeof existing === 'string' && existing.length > 0 ? `${existing}, ${phases}` : phases,
    );
    res.setHeader('X-Response-Time', `${totalMs.toFixed(1)}ms`);
    if (totalMs >= 1000) {
      this.logger.warn(
        `GET /v2/auth/session slow ${totalMs.toFixed(0)}ms `
        + `(db=${(phase.sessionLookupMs + phase.userLookupMs).toFixed(0)})`,
      );
    }

    return {
      authenticated: true,
      cookiePresent: true,
      user: {
        id: user.id.toString(),
        onixId: user.onixId,
        isAdmin: user.isAdmin,
        sessionVersion: user.sessionVersion,
        permissionVersion: user.permissionVersion,
      },
      session: {
        id: session.id,
        rememberMe: session.rememberMe,
        lastSeenAt: session.lastSeenAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.absoluteExpiresAt.toISOString(),
        refreshExpiresAt: session.refreshExpiresAt.toISOString(),
      },
    };
  }

  /**
   * Cookie is the source of truth. Bearer is optional — expired access must not
   * skip logout and leave __Host-onix_rt alive for the next refresh.
   */
  @Post('logout')
  async logout(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { ip?: string; headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientIp = resolveClientIp({ ip: req.ip, headers: req.headers ?? headers, socket: req.socket });
    await this.rateLimit.assert(`auth:v2:logout:${clientIp ?? 'unknown'}`, 30, 60_000);
    assertCsrfHeader(headers);
    const refreshToken = readRefreshTokenFromCookie(headerString(headers, 'cookie'));
    await this.orchestrator.logoutCurrentCookie(refreshToken);
    for (const cookie of buildClearRefreshCookieHeaders()) {
      res.append('Set-Cookie', cookie);
    }
    return { ok: true };
  }

  @UseGuards(AuthV2Guard)
  @Post('logout-all')
  async logoutAll(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { user: AuthV2RequestUser },
    @Res({ passthrough: true }) res: Response,
  ) {
    assertCsrfHeader(headers);
    const result = await this.orchestrator.logoutAll(req.user.id);
    for (const cookie of buildClearRefreshCookieHeaders()) {
      res.append('Set-Cookie', cookie);
    }
    return result;
  }

  @UseGuards(AuthV2Guard)
  @Get('me')
  me(@Req() req: { user: AuthV2RequestUser }) {
    return {
      id: req.user.id.toString(),
      onixId: req.user.onixId,
      isAdmin: req.user.isAdmin,
      sessionId: req.user.sessionId,
      sessionVersion: req.user.sessionVersion,
      permissionVersion: req.user.permissionVersion,
      roles: req.user.roles,
      permissions: req.user.permissions,
    };
  }

  @UseGuards(AuthV2Guard)
  @Get('sessions')
  async listSessions(@Req() req: { user: AuthV2RequestUser }) {
    const rows = await this.sessions.listSessions(req.user.id);
    return rows.map((session) => ({
      id: session.id,
      deviceName: session.deviceName,
      browser: session.browser,
      os: session.os,
      country: session.country,
      city: session.city,
      ipAddress: session.ipAddress,
      lastSeenAt: session.lastSeenAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.absoluteExpiresAt.toISOString(),
      rememberMe: session.rememberMe,
      current: session.id === req.user.sessionId,
    }));
  }

  @UseGuards(AuthV2Guard)
  @Delete('sessions/:id')
  async revokeSession(
    @Param('id') id: string,
    @Req() req: { user: AuthV2RequestUser },
  ) {
    await this.sessions.revokeSession(id, 'LOGOUT', req.user.id);
    return { ok: true };
  }
}

function headerString(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}
