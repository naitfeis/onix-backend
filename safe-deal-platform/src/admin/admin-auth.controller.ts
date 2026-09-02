import {
  Body, Controller, ForbiddenException, Get, Header, HttpCode, Post, Req, Res,
  UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { Public } from '../common';
import { resolveClientIp } from '../http/client-ip';
import { assertRateLimit } from '../rate-limit';
import { isAdminIpAllowed, parseAdminIpAllowlist } from './admin-ip-allowlist';
import { AdminAuthService } from './admin-auth.service';
import {
  buildAdminRefreshCookieHeader,
  buildClearAdminRefreshCookieHeader,
  readAdminRefreshTokenFromCookie,
} from './admin-cookie';
import { AdminAccessGuard, CurrentAdmin } from './admin.guard';
import type { AdminActor } from './admin-session.service';
import { AdminSessionService } from './admin-session.service';

class AdminLoginDto {
  @IsEmail() @MaxLength(191) email!: string;
  @IsString() @Length(8, 200) password!: string;
}

class AdminMfaDto {
  @IsString() @Length(8, 64) challengeId!: string;
  @IsString() @Length(4, 12) code!: string;
}

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly sessions: AdminSessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: AdminLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertIp(req);
    const result = await this.auth.login({
      email: dto.email,
      password: dto.password,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
    if (!result.mfaRequired) {
      res.setHeader(
        'Set-Cookie',
        buildAdminRefreshCookieHeader(result.refreshToken, result.maxAgeSeconds),
      );
      return {
        mfaRequired: false as const,
        accessToken: result.accessToken,
        admin: result.admin,
      };
    }
    return result;
  }

  @Public()
  @Post('resume')
  @HttpCode(200)
  async resume(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertIp(req);
    const result = await this.auth.resumeFromIp({
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.setHeader(
      'Set-Cookie',
      buildAdminRefreshCookieHeader(result.refreshToken, result.maxAgeSeconds),
    );
    return {
      accessToken: result.accessToken,
      admin: result.admin,
    };
  }

  @Public()
  @Post('mfa')
  @HttpCode(200)
  async mfa(
    @Body() dto: AdminMfaDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertIp(req);
    const result = await this.auth.verifyMfa({
      challengeId: dto.challengeId,
      code: dto.code,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.setHeader(
      'Set-Cookie',
      buildAdminRefreshCookieHeader(result.refreshToken, result.maxAgeSeconds),
    );
    return {
      accessToken: result.accessToken,
      admin: result.admin,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertIp(req);
    const refreshToken = readAdminRefreshTokenFromCookie(req.headers.cookie);
    if (!refreshToken) {
      throw new UnauthorizedException('Требуется admin refresh-сессия.');
    }
    const result = await this.sessions.refreshSession({
      refreshToken,
      ip: resolveClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.setHeader(
      'Set-Cookie',
      buildAdminRefreshCookieHeader(result.refreshToken, result.maxAgeSeconds),
    );
    return {
      accessToken: result.accessToken,
      admin: {
        id: result.actor.id.toString(),
        email: result.actor.email,
        role: result.actor.role,
      },
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refresh = readAdminRefreshTokenFromCookie(req.headers.cookie);
    if (refresh) {
      await this.sessions.revokeByRefreshToken(refresh);
    }
    res.setHeader('Set-Cookie', buildClearAdminRefreshCookieHeader());
    return { ok: true };
  }

  @Public()
  @Get('me')
  @UseGuards(AdminAccessGuard)
  @Header('Cache-Control', 'no-store')
  me(@CurrentAdmin() admin: AdminActor) {
    return this.auth.me(admin);
  }

  private assertIp(req: Request): void {
    const allowlist = parseAdminIpAllowlist();
    if (allowlist && !isAdminIpAllowed(resolveClientIp(req), allowlist)) {
      throw new ForbiddenException('Доступ к admin auth с этого IP запрещён.');
    }
    assertRateLimit(`admin-auth-ip:${resolveClientIp(req) ?? 'unknown'}`, 30, 60_000);
  }
}
