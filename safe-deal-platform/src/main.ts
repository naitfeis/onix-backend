import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './auth-v2/request-id.middleware';
import { ApiEnvelopeInterceptor, ApiExceptionFilter } from './common';
import { loadEnvFiles, logProductDeliveryKeyStatus } from './env';
import { registerHealthEndpoint } from './health';
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

  const app = await NestFactory.create(AppModule, {
    // Single Nest logger — avoid duplicate framework noise on Render.
    logger: ['error', 'warn', 'log'],
  });

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
    exposedHeaders: ['Set-Cookie', 'X-Request-Id'],
    credentials: true,
  });
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  bootLog.log(`Listening on ${port}`);
}

void bootstrap();
