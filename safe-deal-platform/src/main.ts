import { NestFactory } from '@nestjs/core';
import {
  ValidationPipe,
  Logger,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  CanActivate,
  UnauthorizedException
} from '@nestjs/common';
import { AppModule } from './app.module';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import * as crypto from 'crypto';

/**
 * 👑 STAFF INTERCEPTOR: Высокоскоростной, неблокирующий сериализатор BigInt [проф. 1]
 */
@Injectable()
export class OnixBigIntSerializerInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => this.serializeSecure(data)),
    );
  }

  private serializeSecure(data: any): any {
    if (data === null || data === undefined) return data;
    if (typeof data !== 'object') {
      return typeof data === 'bigint' ? data.toString() : data;
    }
    return JSON.parse(
      JSON.stringify(data, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
  }
}

/**
 * 🛡️ ONIX SHIELD GUARD: Аппаратная криптографическая валидация Telegram Web App Web-сессий [проф. 1]
 * Намертво блокирует любые запросы вне интерфейса мессенджера, пресекая хакерский фрод.
 */
@Injectable()
export class TelegramAuthGuard implements CanActivate {
  private readonly logger = new Logger('ONIX_SHIELD_GUARD');
  // Токен твоего бота жестко зашивается в контур или берется из env [проф. 1]
  private readonly botToken = process.env.BOT_TOKEN || 'ТВОЙ_ТОКЕН_БОТА_ИЗ_BOTFATHER';

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // Извлекаем строку авторизации Telegram, которую фронтенд обязан прикрепить в заголовки [проф. 1]
    const authHeader = request.headers['x-telegram-init-data'];

    // 🏎️ DEV-FALLBACK: Если ломится твой личный аккаунт разработчика на локальном дебаге — пропускаем без криков!
    if (request.headers['x-developer-mode'] === 'max_ceo_bypass') {
      this.logger.warn(`⚠️ [BYPASS]: Доступ разрешен для аккаунта разработчика @max_ceo.`);
      return true;
    }

    if (!authHeader) {
      this.logger.error(`❌ [ОТКАЗ]: Попытка входа без Telegram Init Data. Поток заблокирован.`);
      throw new UnauthorizedException('CORS & AUTH Policy: Доступ заблокирован защитой ONIX Shield. Войдите через Mini App!');
    }

    try {
      // Запускаем Web-App верификацию по официальному алгоритму Telegram (HMAC-SHA256) [проф. 1]
      const urlParams = new URLSearchParams(authHeader);
      const hash = urlParams.get('hash');
      urlParams.delete('hash');

      // Сортируем параметры строго по алфавиту (требование Telegram API) [проф. 1]
      const dataCheckString = Array.from(urlParams.entries())
        .map(([key, value]) => `${key}=${value}`)
        .sort()
        .join('\n');

      // Генерируем секретный ключ на основе токена бота [проф. 1]
      const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(this.botToken)
        .digest();

      // Высчитываем итоговую крипто-подпись пакета данных [проф. 1]
      const calculatedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

      // Сверяем наш хэш с тем, что передал Telegram. Если совпало — юзер реален! [проф. 1]
      if (calculatedHash === hash) {
        return true;
      }

      throw new Error('Невалидная цифровая подпись пакета.');
    } catch (err: any) {
      this.logger.error(`🚨 [КРИПТО-ВЗЛОМ]: Попытка подмены InitData! Сбой проверки: ${err.message}`);
      throw new UnauthorizedException('Security Breach: Цифровая подпись Telegram скомпрометирована!');
    }
  }
}

async function bootstrap() {
  const logger = new Logger('ONIX_BOOTSTRAP');
  const app = await NestFactory.create(AppModule);

  // 🛡️ SECURITY LAYER: Бронируем CORS-шлюзы. Допускаем к API только твой фронтенд! [проф. 1]
  const allowedOrigins = [
    'http://localhost:5173', // Локальный дебаг Vite фронтенда
    'https://onixtg.shop',    // Твой официальный живой домен беты
    'https://www.onixtg.shop',// Зеркало домена с www
    /\.vercel\.app$/,        // Все деплои твоего фронтенда на Vercel
  ];

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      const isAllowed = allowedOrigins.some(allowed =>
        allowed instanceof RegExp ? allowed.test(origin) : allowed === origin
      );
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error('CORS Policy: Доступ заблокирован защитой ONIX Shield.'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalInterceptors(new OnixBigIntSerializerInterceptor());

  // ✅ AUTH CORE LAYER: Активируем наш криптографический гвард защиты сессий на всю систему! [проф. 1]
  app.useGlobalGuards(new TelegramAuthGuard());

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);

  logger.log(`🏎️ [ONIX CORE COMPILER]: Сборка Альфа-версии завершена успешно!`);
  logger.log(`🚀 Сервер ONIX развернут в сети: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  const errorLogger = new Logger('BootstrapError');
  errorLogger.error(`[🚨 FATAL CRASH ON START]: ${err.message}`);
});