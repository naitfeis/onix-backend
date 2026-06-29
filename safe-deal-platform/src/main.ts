import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory, Reflector } from '@nestjs/core';
import {
  ValidationPipe,
  Logger,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  CanActivate,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import * as crypto from 'crypto';
import { AppModule } from './app.module';

// ─── Декоратор для пропуска TelegramAuthGuard ────────────────────────────────
export const SKIP_TELEGRAM_AUTH = 'skipTelegramAuth';
export const SkipTelegramAuth = () => SetMetadata(SKIP_TELEGRAM_AUTH, true);

// ─── BigInt Serializer ───────────────────────────────────────────────────────
@Injectable()
class BigIntSerializerInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => JSON.parse(JSON.stringify(data, (_key, val) =>
        typeof val === 'bigint' ? val.toString() : val
      )))
    );
  }
}

// ─── Telegram Auth Guard ─────────────────────────────────────────────────────
@Injectable()
class TelegramAuthGuard implements CanActivate {
  private readonly logger = new Logger('TelegramAuthGuard');
  private readonly botToken = process.env.BOT_TOKEN ?? '';
  private readonly isDev = process.env.NODE_ENV !== 'production';

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // Пропускаем эндпоинты помеченные @SkipTelegramAuth()
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TELEGRAM_AUTH, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<{
      path: string;
      headers: Record<string, string | undefined>;
    }>();

    // Пропускаем webhook — Telegram сам его вызывает, без initData
    if (req.path?.includes('telegram-webhook')) {
      return true;
    }

    // Dev bypass — только если не production
    if (this.isDev && req.headers['x-developer-mode'] === 'onix_dev_bypass') {
      this.logger.warn('[GUARD] Dev bypass активирован (не для production!)');
      return true;
    }

    const initData = req.headers['x-telegram-init-data'];
    if (!initData) {
      throw new UnauthorizedException('Доступ только через Telegram Mini App.');
    }

    if (!this.botToken) {
      this.logger.error('[GUARD] BOT_TOKEN не задан — невозможно верифицировать подпись.');
      throw new UnauthorizedException('Ошибка конфигурации сервера.');
    }

    try {
      const params = new URLSearchParams(initData);
      const receivedHash = params.get('hash');
      if (!receivedHash) throw new Error('Отсутствует hash в initData.');

      params.delete('hash');

      const dataCheckString = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');

      const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(this.botToken)
        .digest();

      const expectedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

      if (expectedHash !== receivedHash) {
        throw new Error('Хэш не совпадает.');
      }

      return true;
    } catch (err) {
      this.logger.error(`[GUARD] Невалидная подпись Telegram: ${(err as Error).message}`);
      throw new UnauthorizedException('Цифровая подпись Telegram недействительна.');
    }
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const allowedOrigins: Array<string | RegExp> = [
    'http://localhost:5173',
    'https://onixtg.shop',
    'https://www.onixtg.shop',
    /\.vercel\.app$/,
  ];

  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return cb(null, true);
      const allowed = allowedOrigins.some((o) =>
        o instanceof RegExp ? o.test(origin) : o === origin
      );
      allowed
        ? cb(null, true)
        : cb(new Error(`CORS: Origin "${origin}" не разрешён.`));
    },
    methods: 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalInterceptors(new BigIntSerializerInterceptor());

  // Передаём Reflector в Guard чтобы работал @SkipTelegramAuth()
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new TelegramAuthGuard(reflector));

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);

  logger.log(`[ONIX] Бэкенд запущен на порту ${port}`);
  logger.log(`[ONIX] Режим: ${process.env.NODE_ENV ?? 'development'}`);
}

bootstrap().catch((err: Error) => {
  new Logger('Bootstrap').error(`[FATAL] Ошибка запуска: ${err.message}`);
  process.exit(1);
});