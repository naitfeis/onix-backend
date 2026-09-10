import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './auth-v2/request-id.middleware';
import { authSessionPathMiddleware } from './auth-v2/auth-session-path.middleware';
import { buildInfo } from './build-info';
import { ApiEnvelopeInterceptor } from './common';
import { loadEnvFiles, logProductDeliveryKeyStatus } from './env';
import { logSecretsInventory } from './auth-v2/secrets-inventory';
import { registerHealthEndpoint } from './health';
import { createMetricsMiddleware } from './observability/metrics.middleware';
import { MetricsService } from './observability/metrics.service';
import { registerGracefulShutdown } from './observability/graceful-shutdown';
import { structuredLog } from './observability/structured-logger';
import { requestTimingMiddleware } from './request-timing.middleware';
import { httpNoiseMiddleware } from './http-noise.middleware';
import { createSecurityMiddleware, resolveCorsOrigins, canonicalWwwHostMiddleware } from './security-headers';
import { originAccessMiddleware, assertOriginLaunchGate } from './http/origin-access.middleware';
import { RealtimeHubService } from './realtime/realtime-hub.service';
import { spaAuthGoogleCallbackMiddleware, spaIndexExists } from './spa-static';
import { validationExceptionFactory } from './validation-errors';

/** Same-process guard — Nest must bootstrap exactly once per Node process. */
let bootstrapStarted = false;

async function bootstrap(): Promise<void> {
  if (bootstrapStarted) {
    throw new Error('bootstrap() invoked twice in the same process');
  }
  bootstrapStarted = true;

  loadEnvFiles();
  process.env.OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'onix-api';

  assertOriginLaunchGate();

  logProductDeliveryKeyStatus({
    log: (m) => structuredLog.info(m),
    warn: (m) => structuredLog.warn(m),
  });
  logSecretsInventory({
    log: (m) => structuredLog.info(m),
    warn: (m) => structuredLog.warn(m),
  });
  structuredLog.info('NestFactory starting', buildInfo());

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Single Nest logger — avoid duplicate framework noise on Render.
    logger: ['error', 'warn', 'log'],
  });

  // Amvera ingress (or Render LB) terminates TLS and forwards X-Forwarded-For.
  // Do not trust Cloudflare client headers unless TRUST_CDN_HEADERS=true — see client-ip.ts.
  // Without this, Express `req.ip` is often the proxy peer (::1 / 127.0.0.1).
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy === 'false' || trustProxy === '0') {
    app.set('trust proxy', false);
  } else if (trustProxy && /^\d+$/.test(trustProxy)) {
    app.set('trust proxy', Number(trustProxy));
  } else {
    // Default: trust one hop (Render LB / Cloudflare → Nest).
    app.set('trust proxy', 1);
  }

  // Security headers first (Helmet + CSP).
  app.use(createSecurityMiddleware());
  app.use(canonicalWwwHostMiddleware);
  // Reject direct-IP Host / unknown hosts in production (DNS-only Amvera).
  app.use(originAccessMiddleware);
  // Scanners before ServeStatic / Nest (clean 404, never 500).
  app.use(httpNoiseMiddleware);
  app.use(spaAuthGoogleCallbackMiddleware);
  // gzip only in production (Render NODE_ENV=production). Dev stays uncompressed for easier debugging.
  if (process.env.NODE_ENV === 'production') {
    app.use(compression());
  }
  // requestId first so timing/metrics/logs can correlate every request.
  app.use(requestIdMiddleware);
  app.use(requestTimingMiddleware);
  app.use(createMetricsMiddleware(app.get(MetricsService)));

  const spaEnabled = spaIndexExists();
  registerHealthEndpoint(app, { spaEnabled });

  app.setGlobalPrefix('api');
  // Before Nest AuthGuard / controllers — must log even if handler never runs.
  app.use(authSessionPathMiddleware);
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: validationExceptionFactory,
  }));
  app.useBodyParser('json', { limit: '128kb' });
  app.useBodyParser('urlencoded', { limit: '64kb', extended: true });
  app.useGlobalInterceptors(new ApiEnvelopeInterceptor());
  const origins = resolveCorsOrigins();
  app.enableCors({
    origin: origins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-ONIX-CSRF', 'Cookie', 'X-Request-Id'],
    exposedHeaders: ['Set-Cookie', 'X-Request-Id', 'X-Response-Time', 'Server-Timing'],
    credentials: true,
  });
  app.enableShutdownHooks();
  registerGracefulShutdown(app, { role: 'api' });

  const port = Number(process.env.PORT ?? 3000);
  // PaaS ingress (Render, Amvera) probes the container from another netns.
  await app.listen(port, '0.0.0.0');

  // Keep-alive tuned for Render reverse proxy (avoid premature socket close).
  const server = app.getHttpServer();
  server.keepAliveTimeout = Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS ?? 65_000);
  server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS ?? 66_000);
  server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS ?? 120_000);

  // Stage 5.6 realtime — same HTTP server, path /api/realtime
  app.get(RealtimeHubService).attach(server);

  structuredLog.info('Listening', {
    port,
    spaEnabled,
    corsOrigins: origins.join(','),
    keepAliveTimeout: server.keepAliveTimeout,
    ...buildInfo(),
  });

  process.on('unhandledRejection', (reason) => {
    structuredLog.error('unhandledRejection', {}, reason);
  });
  process.on('uncaughtException', (err) => {
    structuredLog.error('uncaughtException', {}, err);
  });
}

void bootstrap();
