import {
  Body, Controller, Get, Headers, Post, Query, Req, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import {
  buildRefreshCookieHeader,
} from '../auth-v2/refresh-cookie';
import { getWebsiteLoginProvider, LOGIN_CHALLENGE_TTL_MS } from './login-challenge.flags';
import { LoginChallengeService } from './login-challenge.service';
import {
  buildLoginSessionCookieHeader,
  readLoginSessionId,
} from './login-session-cookie';
import { assertRateLimit } from '../rate-limit';

@Public()
@Controller('v2/auth/telegram-bot')
export class BotLoginController {
  constructor(private readonly challenges: LoginChallengeService) {}

  @Get('provider')
  provider() {
    return { provider: getWebsiteLoginProvider() };
  }

  @Post('start')
  async start(
    @Body() body: { browserFingerprintHash?: string; rememberMe?: boolean },
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { ip?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    assertRateLimit(`auth:bot:start:${req.ip ?? 'unknown'}`, 10, 60_000);
    const existing = readLoginSessionId(headerString(headers, 'cookie'));
    const started = await this.challenges.start({
      loginSessionId: existing,
      browserFingerprintHash: body?.browserFingerprintHash,
      createdIp: req.ip,
      createdUserAgent: headerString(headers, 'user-agent'),
    });

    res.setHeader(
      'Set-Cookie',
      buildLoginSessionCookieHeader(
        started.loginSessionId,
        Math.floor(LOGIN_CHALLENGE_TTL_MS / 1000),
      ),
    );

    return {
      challengeId: started.challengeId,
      expiresAt: started.expiresAt,
      status: started.status,
      deepLink: started.deepLink,
      webDeepLink: started.webDeepLink,
      provider: getWebsiteLoginProvider(),
    };
  }

  @Get('status')
  async status(
    @Query('challengeId') challengeId: string,
    @Req() req: { ip?: string },
  ) {
    assertRateLimit(`auth:bot:status:${req.ip ?? 'unknown'}`, 60, 60_000);
    return this.challenges.status(challengeId);
  }

  @Post('opened')
  async opened(@Body() body: { challengeId: string }) {
    return this.challenges.markOpened(body.challengeId);
  }

  @Post('complete')
  async complete(
    @Body() body: { challengeId: string; rememberMe?: boolean; device?: Record<string, unknown> },
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { ip?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    assertRateLimit(`auth:bot:complete:${req.ip ?? 'unknown'}`, 20, 60_000);
    const loginSessionId = readLoginSessionId(headerString(headers, 'cookie'));
    if (!loginSessionId) {
      throw new AuthPlatformError('AUTH_CSRF_REJECTED', 'Login session cookie is required.');
    }

    const result = await this.challenges.complete({
      challengeId: body.challengeId,
      loginSessionId,
      rememberMe: body.rememberMe,
      device: {
        ...(body.device as object),
        userAgent: headerString(headers, 'user-agent'),
        ipAddress: req.ip,
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
        createdAt: result.session.createdAt.toISOString(),
        expiresAt: result.session.absoluteExpiresAt.toISOString(),
        rememberMe: result.session.rememberMe,
      },
    };
  }

  @Post('continue')
  async continueWithCode(
    @Body() body: { exchangeCode: string; rememberMe?: boolean },
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { ip?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const loginSessionId = readLoginSessionId(headerString(headers, 'cookie'));
    const result = await this.challenges.completeWithExchangeCode({
      exchangeCode: body.exchangeCode,
      loginSessionId,
      rememberMe: body.rememberMe,
      device: {
        userAgent: headerString(headers, 'user-agent'),
        ipAddress: req.ip,
      },
    });

    res.setHeader('Set-Cookie', buildRefreshCookieHeader(result.refreshToken, result.refreshMaxAgeSeconds));

    return {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: result.user.id.toString(),
        onixId: result.user.onixId,
        isAdmin: result.user.isAdmin,
        sessionVersion: result.user.sessionVersion,
        permissionVersion: result.user.permissionVersion,
      },
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
