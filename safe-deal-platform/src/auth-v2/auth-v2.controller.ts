import {
  Body, Controller, Delete, Get, Header, Headers, Logger, Param, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common';
import { AuthOrchestrator } from './auth-orchestrator.service';
import { AuthPlatformError } from './auth-errors';
import { LoginDto, RefreshDto } from './auth-v2.dto';
import { AuthV2Guard, type AuthV2RequestUser } from './auth-v2.guards';
import {
  assertCsrfHeader,
  buildClearRefreshCookieHeader,
  buildRefreshCookieHeader,
  readRefreshTokenFromCookie,
} from './refresh-cookie';
import { SessionService } from './session.service';

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
  ) {}

  @Post('login')
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() body: LoginDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { ip?: string; headers: Record<string, string | undefined> },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.orchestrator.loginWithTelegram({
      telegram: body.telegram,
      rememberMe: body.rememberMe,
      device: {
        ...body.device,
        userAgent: body.device?.userAgent ?? headerString(headers, 'user-agent'),
        ipAddress: body.device?.ipAddress ?? req.ip,
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

  @Post('refresh')
  @Header('Cache-Control', 'no-store')
  async refresh(
    @Body() body: RefreshDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { ip?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const t0 = process.hrtime.bigint();
    assertCsrfHeader(headers);
    const refreshToken = readRefreshTokenFromCookie(headerString(headers, 'cookie'));
    if (!refreshToken) {
      throw new AuthPlatformError('AUTH_REFRESH_MISSING', 'Refresh cookie is missing.');
    }

    const timing = { dbMs: 0, tokenMs: 0 };
    const result = await this.orchestrator.refresh(refreshToken, {
      ...body.device,
      userAgent: body.device?.userAgent ?? headerString(headers, 'user-agent'),
      ipAddress: body.device?.ipAddress ?? req.ip,
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
    @Res({ passthrough: true }) res: Response,
  ) {
    const t0 = performance.now();
    // Entry log so Render shows the hit even if the client aborts mid-flight.
    this.logger.log('GET /v2/auth/session start');

    const tCookie = performance.now();
    const refreshToken = readRefreshTokenFromCookie(headerString(headers, 'cookie'));
    const cookieParseMs = performance.now() - tCookie;

    if (!refreshToken) {
      const totalMs = performance.now() - t0;
      res.setHeader(
        'Server-Timing',
        [
          `cookie-parse;dur=${cookieParseMs.toFixed(1)}`,
          `session-lookup;dur=0`,
          `database-query;dur=0`,
          `user-lookup;dur=0`,
          `response;dur=${totalMs.toFixed(1)}`,
        ].join(', '),
      );
      res.setHeader('X-Response-Time', `${totalMs.toFixed(1)}ms`);
      this.logger.log(`GET /v2/auth/session 401 missing-cookie ${totalMs.toFixed(1)}ms`);
      throw new AuthPlatformError('AUTH_REFRESH_MISSING', 'Refresh cookie is missing.');
    }

    const phase = {
      hashMs: 0,
      sessionLookupMs: 0,
      userLookupMs: 0,
    };
    const { user, session } = await this.sessions.getSessionByRefreshToken(refreshToken, phase);
    const totalMs = performance.now() - t0;
    const responseMs = totalMs - cookieParseMs - phase.hashMs - phase.sessionLookupMs - phase.userLookupMs;

    res.setHeader(
      'Server-Timing',
      [
        `cookie-parse;dur=${cookieParseMs.toFixed(1)}`,
        `hash;dur=${phase.hashMs.toFixed(1)}`,
        `session-lookup;dur=${phase.sessionLookupMs.toFixed(1)}`,
        `database-query;dur=${phase.sessionLookupMs.toFixed(1)}`,
        `user-lookup;dur=${phase.userLookupMs.toFixed(1)}`,
        `response;dur=${Math.max(0, responseMs).toFixed(1)}`,
        `auth-session;dur=${totalMs.toFixed(1)}`,
      ].join(', '),
    );
    res.setHeader('X-Response-Time', `${totalMs.toFixed(1)}ms`);
    this.logger.log(
      `GET /v2/auth/session 200 ${totalMs.toFixed(1)}ms `
      + `(cookie=${cookieParseMs.toFixed(1)} hash=${phase.hashMs.toFixed(1)} `
      + `db=${phase.sessionLookupMs.toFixed(1)} user=${phase.userLookupMs.toFixed(1)})`,
    );

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

  @UseGuards(AuthV2Guard)
  @Post('logout')
  async logout(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { user: AuthV2RequestUser },
    @Res({ passthrough: true }) res: Response,
  ) {
    assertCsrfHeader(headers);
    await this.orchestrator.logout(req.user.sessionId, req.user.id);
    res.setHeader('Set-Cookie', buildClearRefreshCookieHeader());
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
    res.setHeader('Set-Cookie', buildClearRefreshCookieHeader());
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
