import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './auth-v2/request-id.middleware';
import { ApiEnvelopeInterceptor, ApiExceptionFilter } from './common';
import { loadEnvFiles, logProductDeliveryKeyStatus } from './env';
import { registerHealthEndpoint } from './health';
import { requestTimingMiddleware } from './request-timing.middleware';
import { validationExceptionFactory } from './validation-errors';

/** Same-process guard — Nest must bootstrap exactly once per Node process. */
let bootstrapStarted = false;

async function bootstrap(): Promise<void> {
  if (bootstrapStarted) {
    throw new Error('bootstrap() invoked twice in the same process');
  }
  bootstrapStarted = true;

  loadEnvFiles();

  const bootLog = new Logger('Bootstrap');
  logProductDeliveryKeyStatus(bootLog);
  bootLog.log('NestFactory starting');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Single Nest logger — avoid duplicate framework noise on Render.
    logger: ['error', 'warn', 'log'],
  });

  // gzip only in production (Render NODE_ENV=production). Dev stays uncompressed for easier debugging.
  if (process.env.NODE_ENV === 'production') {
    app.use(compression());
  }
  app.use(requestTimingMiddleware);

  registerHealthEndpoint(app);

  app.setGlobalPrefix('api');
  app.use(requestIdMiddleware);
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: validationExceptionFactory,
  }));
  app.useGlobalInterceptors(new ApiEnvelopeInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',').map((value) => value.trim()).filter(Boolean);
  app.enableCors({
    origin: origins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-ONIX-CSRF', 'Cookie', 'X-Request-Id'],
    exposedHeaders: ['Set-Cookie', 'X-Request-Id', 'X-Response-Time', 'Server-Timing'],
    credentials: true,
  });
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  // Keep-alive tuned for Render reverse proxy (avoid premature socket close).
  const server = app.getHttpServer();
  server.keepAliveTimeout = Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS ?? 65_000);
  server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS ?? 66_000);
  server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS ?? 120_000);

  bootLog.log(`Listening on ${port} (single Node process, keepAlive=${server.keepAliveTimeout}ms)`);
}

void bootstrap();
