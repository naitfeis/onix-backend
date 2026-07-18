import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './workers/worker.module';
import { loadEnvFiles } from './env';
import { registerGracefulShutdown } from './observability/graceful-shutdown';
import { structuredLog } from './observability/structured-logger';

let started = false;

async function bootstrap(): Promise<void> {
  if (started) throw new Error('worker bootstrap invoked twice');
  started = true;
  loadEnvFiles();
  process.env.OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'onix-worker';

  structuredLog.info('worker starting');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.enableShutdownHooks();
  registerGracefulShutdown(app, { role: 'worker' });

  process.on('unhandledRejection', (reason) => {
    structuredLog.error('worker unhandledRejection', {}, reason);
  });
  process.on('uncaughtException', (err) => {
    structuredLog.error('worker uncaughtException', {}, err);
  });

  structuredLog.info('worker running');
}

void bootstrap();
