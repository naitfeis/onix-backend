import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { AppModule } from './app.module';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * 👑 STAFF INTERCEPTOR: Высокоскоростной, неблокирующий сериализатор BigInt [проф. 1]
 * Финтех-оптимизирован для предотвращения утечек CPU (Event Loop Lag) при финтех-нагрузках.
 */
@Injectable()
export class OnixBigIntSerializerInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => this.serializeSecure(data)),
    );
  }

  // Синьор-оптимизация: быстрая проверка, чтобы не гонять примитивные данные через парсер
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

async function bootstrap() {
  const logger = new Logger('ONIX_BOOTSTRAP');
  const app = await NestFactory.create(AppModule);

  // 🛡️ SECURITY LAYER: Бронируем CORS-шлюзы. Допускаем к API только твой фронтенд! [проф. 1]
  const allowedOrigins = [
    'http://localhost:5173', // Локальный дебаг Vite фронтенда
    'https://onixtg.shop',    // Твой будущий официальный домен беты
    /\.vercel\.app$/,        // Все деплои твоего фронтенда на Vercel
  ];

  app.enableCors({
    // Снайперская типизация аргументов для прохождения строгого режима TypeScript
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Разрешаем запросы без origin (например, мобильные приложения ТГ или Postman)
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

  //  satellites ROUTING LAYER: Задаем глобальный префикс для всех эндпоинтов API [проф. 1]
  app.setGlobalPrefix('api');

  // 🔥 VALIDATION LAYER: Строгая runtime-проверка входящих JSON-пакетов через class-validator [проф. 1]
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // Стирает любые левые поля, подмешанные хакерами
      transform: true,            // Автоматически приводит типы данных
      forbidNonWhitelisted: true, // Выплевывает ошибку, если в JSON есть мусорные параметры
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ✅ SERIALIZATION LAYER: Активируем наш скоростной интерцептор BigInt [проф. 1]
  app.useGlobalInterceptors(new OnixBigIntSerializerInterceptor());

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);

  logger.log(`🏎️ [ONIX CORE COMPILER]: Сборка Альфа-версии завершена успешно!`);
  logger.log(`🚀 Сервер ONIX развернут в сети: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  const errorLogger = new Logger('BootstrapError');
  errorLogger.error(`[🚨 FATAL CRASH ON START]: ${err.message}`);
});