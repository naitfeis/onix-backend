import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './auth-v2/request-id.middleware';
import { ApiEnvelopeInterceptor, ApiExceptionFilter } from './common';
import { loadEnvFiles, logProductDeliveryKeyStatus } from './env';
import { validationExceptionFactory } from './validation-errors';

loadEnvFiles();

async function bootstrap(): Promise<void> {
  const bootLog = new Logger('Bootstrap');
  logProductDeliveryKeyStatus(bootLog);

  const app = await NestFactory.create(AppModule);
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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-ONIX-CSRF', 'Cookie', 'X-Request-Id'],
    exposedHeaders: ['Set-Cookie', 'X-Request-Id'],
    credentials: true,
  });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  bootLog.log(`ONIX API listening on ${port}`);
}

void bootstrap();
