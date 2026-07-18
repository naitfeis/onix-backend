import { Injectable, OnModuleInit } from '@nestjs/common';
import { redactSecrets } from '../safe-error-log';
import { structuredLog } from './structured-logger';
import { MetricsService } from './metrics.service';

export type ErrorEvent = {
  message: string;
  name?: string;
  stack?: string;
  requestId?: string;
  route?: string;
  userId?: string;
  tags?: Record<string, string>;
  level?: 'error' | 'fatal' | 'warning';
};

/**
 * Error tracking sink:
 * - always structured-logs
 * - optionally POSTs to ERROR_WEBHOOK_URL (Slack/Discord/PagerDuty-compatible JSON)
 * - optionally POSTs a minimal Sentry-compatible envelope when SENTRY_DSN is set
 */
@Injectable()
export class ErrorTrackingService implements OnModuleInit {
  private readonly recent: ErrorEvent[] = [];
  private webhookUrl: string | null = null;
  private sentryDsn: string | null = null;

  constructor(private readonly metrics: MetricsService) {}

  onModuleInit(): void {
    this.webhookUrl = (process.env.ERROR_WEBHOOK_URL ?? '').trim() || null;
    this.sentryDsn = (process.env.SENTRY_DSN ?? '').trim() || null;
  }

  capture(error: unknown, context: Omit<ErrorEvent, 'message' | 'name' | 'stack'> = {}): void {
    const event = this.toEvent(error, context);
    this.recent.push(event);
    if (this.recent.length > 100) this.recent.shift();

    this.metrics.inc('onix_errors_captured_total', {
      level: event.level ?? 'error',
      name: (event.name ?? 'Error').slice(0, 64),
    });

    structuredLog.error(event.message, {
      requestId: event.requestId,
      route: event.route,
      userId: event.userId,
      errName: event.name,
      ...event.tags,
    }, error);

    void this.forward(event);
  }

  recentErrors(): ErrorEvent[] {
    return [...this.recent];
  }

  private toEvent(error: unknown, context: Omit<ErrorEvent, 'message' | 'name' | 'stack'>): ErrorEvent {
    if (error instanceof Error) {
      return {
        message: redactSecrets(error.message || 'Error'),
        name: error.name,
        stack: error.stack ? redactSecrets(error.stack) : undefined,
        level: 'error',
        ...context,
      };
    }
    return {
      message: redactSecrets(typeof error === 'string' ? error : 'Unknown error'),
      name: 'Error',
      level: 'error',
      ...context,
    };
  }

  private async forward(event: ErrorEvent): Promise<void> {
    if (this.webhookUrl) {
      try {
        await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: `[ONIX ${event.level ?? 'error'}] ${event.name}: ${event.message}`,
            event,
          }),
          signal: AbortSignal.timeout(3_000),
        });
      } catch (err) {
        structuredLog.warn('error webhook failed', {}, err);
      }
    }
    if (this.sentryDsn) {
      try {
        await this.sendSentry(event);
      } catch (err) {
        structuredLog.warn('sentry forward failed', {}, err);
      }
    }
  }

  /** Minimal Sentry store API — enough for stack visibility without @sentry/node. */
  private async sendSentry(event: ErrorEvent): Promise<void> {
    const dsn = this.sentryDsn!;
    const m = dsn.match(/^https?:\/\/([^@]+)@([^/]+)\/(\d+)/);
    if (!m) return;
    const [, key, host, project] = m;
    const url = `https://${host}/api/${project}/store/?sentry_key=${key}&sentry_version=7`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=onix/1.0`,
      },
      body: JSON.stringify({
        message: event.message,
        level: event.level ?? 'error',
        platform: 'node',
        tags: event.tags,
        extra: {
          requestId: event.requestId,
          route: event.route,
          userId: event.userId,
        },
        exception: event.stack
          ? { values: [{ type: event.name, value: event.message, stacktrace: { frames: [] } }] }
          : undefined,
        timestamp: Date.now() / 1000,
      }),
      signal: AbortSignal.timeout(3_000),
    });
  }
}
