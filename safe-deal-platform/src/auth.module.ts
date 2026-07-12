import {
  Body, CanActivate, Controller, ExecutionContext, Injectable, Module, Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { IsInt, IsOptional, IsString, IsUrl, Matches, MaxLength, Min } from 'class-validator';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from './prisma.service';
import { AuthRequest, AuthUser, Public } from './common';

interface TelegramIdentity {
  id: bigint;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
  languageCode?: string | null;
}

class MiniAppDto {
  @IsString() @MaxLength(10000) initData!: string;
}

class TelegramLoginDto {
  @IsString() @Matches(/^\d+$/) id!: string;
  @IsString() @MaxLength(120) first_name!: string;
  @IsOptional() @IsString() @MaxLength(120) last_name?: string;
  @IsOptional() @IsString() @MaxLength(64) username?: string;
  @IsOptional() @IsUrl() photo_url?: string;
  @IsInt() @Min(1) auth_date!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/i) hash!: string;
}

@Injectable()
export class AuthService {
  private readonly maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS ?? 3600);

  constructor(private readonly prisma: PrismaService) {}

  async miniApp(initData: string) {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    const userJson = params.get('user');
    this.assertFresh(Number(params.get('auth_date')));
    if (!hash || !userJson) throw new UnauthorizedException('Telegram InitData неполон.');
    params.delete('hash');
    this.verifyHash(
      [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n'),
      hash,
      createHmac('sha256', 'WebAppData').update(this.botToken()).digest(),
    );
    const value = JSON.parse(userJson) as Record<string, unknown>;
    return this.issue(await this.upsert({
      id: BigInt(String(value.id)),
      username: typeof value.username === 'string' ? value.username : null,
      firstName: typeof value.first_name === 'string' ? value.first_name : null,
      lastName: typeof value.last_name === 'string' ? value.last_name : null,
      photoUrl: typeof value.photo_url === 'string' ? value.photo_url : null,
      languageCode: typeof value.language_code === 'string' ? value.language_code : null,
    }));
  }

  async telegramLogin(dto: TelegramLoginDto) {
    this.assertFresh(dto.auth_date);
    const { hash, ...data } = dto;
    const check = Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    this.verifyHash(check, hash, createHash('sha256').update(this.botToken()).digest());
    return this.issue(await this.upsert({
      id: BigInt(dto.id), username: dto.username ?? null, firstName: dto.first_name,
      lastName: dto.last_name ?? null, photoUrl: dto.photo_url ?? null,
    }));
  }

  async verifyToken(token: string): Promise<AuthUser> {
    try {
      const [header, body, signature] = token.split('.');
      if (!header || !body || !signature) throw new Error('format');
      const expected = createHmac('sha256', this.jwtSecret()).update(`${header}.${body}`).digest('base64url');
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('signature');
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as { sub: string; exp: number };
      if (payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('expired');
      const user = await this.prisma.user.findUnique({ where: { id: BigInt(payload.sub) } });
      if (!user || user.deletedAt) throw new Error('inactive');
      return { id: user.id, telegramId: user.telegramId, onixId: user.onixId, isAdmin: user.isAdmin };
    } catch (error) {
      console.error(error);
      if (error instanceof Error) console.error(error.stack);
      throw new UnauthorizedException('Сессия недействительна или истекла. Войдите снова.');
    }
  }

  private async upsert(identity: TelegramIdentity): Promise<AuthUser> {
    const existing = await this.prisma.user.findUnique({ where: { telegramId: identity.id } });
    if (existing?.deletedAt) throw new UnauthorizedException('Аккаунт заблокирован.');
    const loggedInAt = new Date();
    const displayName = [identity.firstName, identity.lastName].filter(Boolean).join(' ') || null;
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: this.profileChanges(existing, identity, displayName, loggedInAt),
        })
      : await this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              telegramId: identity.id, onixId: `PENDING-${identity.id}`,
              telegramNick: identity.username, firstName: identity.firstName, lastName: identity.lastName,
              languageCode: identity.languageCode, displayName, avatarUrl: identity.photoUrl,
              lastSeenAt: loggedInAt, lastLoginAt: loggedInAt,
              isAdmin: process.env.ADMIN_TELEGRAM_ID === identity.id.toString(),
            },
          });
          return tx.user.update({
            where: { id: created.id },
            data: { onixId: `ONIX-${created.id.toString().padStart(6, '0')}` },
          });
        });
    if (user.deletedAt) throw new UnauthorizedException('Аккаунт заблокирован.');
    return { id: user.id, telegramId: user.telegramId, onixId: user.onixId, isAdmin: user.isAdmin };
  }

  private profileChanges(
    existing: {
      telegramNick: string | null;
      firstName: string | null;
      lastName: string | null;
      languageCode: string | null;
      displayName: string | null;
      avatarUrl: string | null;
    },
    identity: TelegramIdentity,
    displayName: string | null,
    loggedInAt: Date,
  ): Prisma.UserUpdateInput {
    const data: Prisma.UserUpdateInput = { lastSeenAt: loggedInAt, lastLoginAt: loggedInAt };
    if (identity.username !== undefined && identity.username !== existing.telegramNick) data.telegramNick = identity.username;
    if (identity.firstName !== undefined && identity.firstName !== existing.firstName) data.firstName = identity.firstName;
    if (identity.lastName !== undefined && identity.lastName !== existing.lastName) data.lastName = identity.lastName;
    if (identity.languageCode !== undefined && identity.languageCode !== existing.languageCode) data.languageCode = identity.languageCode;
    if (identity.photoUrl !== undefined && identity.photoUrl !== existing.avatarUrl) data.avatarUrl = identity.photoUrl;
    if ((identity.firstName !== undefined || identity.lastName !== undefined) && displayName !== existing.displayName) {
      data.displayName = displayName;
    }
    return data;
  }

  private async issue(user: AuthUser) {
    const now = Math.floor(Date.now() / 1000);
    const days = Number(process.env.JWT_TTL_DAYS ?? 7);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
      sub: user.id.toString(), telegramId: user.telegramId.toString(),
      iss: 'onix-api', iat: now, exp: now + days * 86400,
    })).toString('base64url');
    const signature = createHmac('sha256', this.jwtSecret()).update(`${header}.${body}`).digest('base64url');
    return {
      accessToken: `${header}.${body}.${signature}`,
      tokenType: 'Bearer',
      expiresIn: `${days}d`,
      user,
    };
  }

  private verifyHash(check: string, received: string, secret: Buffer): void {
    const expected = createHmac('sha256', secret).update(check).digest();
    const actual = Buffer.from(received, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException('Подпись Telegram недействительна.');
    }
  }

  private assertFresh(authDate: number): void {
    const age = Math.floor(Date.now() / 1000) - authDate;
    if (!Number.isSafeInteger(authDate) || age < -30 || age > this.maxAgeSeconds) {
      throw new UnauthorizedException('Данные Telegram устарели.');
    }
  }

  private botToken(): string {
    const token = process.env.BOT_TOKEN;
    if (!token) throw new UnauthorizedException('Telegram auth не настроен на сервере.');
    return token;
  }

  private jwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) throw new UnauthorizedException('JWT_SECRET должен содержать минимум 32 символа.');
    return secret;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>('public', [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const value = request.headers.authorization;
    if (!value?.startsWith('Bearer ')) throw new UnauthorizedException('Требуется подтверждённая сессия.');
    request.user = await this.auth.verifyToken(value.slice(7));
    return true;
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public()
  @Post('telegram-mini')
  miniApp(@Body() dto: MiniAppDto) {
    return this.auth.miniApp(dto.initData);
  }

  @Public()
  @Post('telegram-login')
  telegramLogin(@Body() dto: TelegramLoginDto) {
    return this.auth.telegramLogin(dto);
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
