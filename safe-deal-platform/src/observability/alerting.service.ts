import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { structuredLog } from './structured-logger';
import { MetricsService } from './metrics.service';
import { ErrorTrackingService } from './error-tracking.service';

export type AlertRule = {
  id: string;
  /** Metric counter name prefix, e.g. onix_http_errors_total */
  metric: string;
  /** Fire when counter delta over window exceeds this. */
  threshold: number;
  windowSec: number;
  severity: 'warning' | 'critical';
  description: string;
};

const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'http-5xx-burst',
    metric: 'onix_http_errors_total',
    threshold: 20,
    windowSec: 60,
    severity: 'critical',
    description: 'HTTP 5xx burst',
  },
  {
    id: 'money-ops-errors',
    metric: 'onix_money_ops_total',
    threshold: 10,
    windowSec: 120,
    severity: 'critical',
    description: 'Money operation failures',
  },
  {
    id: 'worker-job-failures',
    metric: 'onix_worker_jobs_total',
    threshold: 5,
    windowSec: 300,
    severity: 'warning',
    description: 'Worker job failures',
  },
  {
    id: 'errors-captured',
    metric: 'onix_errors_captured_total',
    threshold: 30,
    windowSec: 60,
    severity: 'critical',
    description: 'Captured application errors',
  },
];

/**
 * Lightweight in-process alert evaluator.
 * Reads MetricsService snapshots on an interval; fires webhook + error tracker.
 * For production paging, point ALERT_WEBHOOK_URL at PagerDuty/Opsgenie/Slack.
 */
@Injectable()
export class AlertingService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private readonly baselines = new Map<string, number>();
  private readonly lastFired = new Map<string, number>();
  private rules: AlertRule[] = DEFAULT_RULES;
  private webhookUrl: string | null = null;

  constructor(
    private readonly metrics: MetricsService,
    private readonly errors: ErrorTrackingService,
  ) {}

  onModuleInit(): void {
    this.webhookUrl = (process.env.ALERT_WEBHOOK_URL ?? process.env.ERROR_WEBHOOK_URL ?? '').trim() || null;
    const raw = process.env.ALERT_RULES_JSON?.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as AlertRule[];
        if (Array.isArray(parsed) && parsed.length) this.rules = parsed;
      } catch (err) {
        structuredLog.warn('ALERT_RULES_JSON invalid — using defaults', {}, err);
      }
    }
    const enabled = (process.env.ALERTING_ENABLED ?? 'true').toLowerCase();
    if (enabled === '0' || enabled === 'false' || enabled === 'no') return;
    const everyMs = Number(process.env.ALERT_EVAL_INTERVAL_MS ?? 15_000);
    this.timer = setInterval(() => this.evaluate(), Number.isFinite(everyMs) ? everyMs : 15_000);
    this.timer.unref?.();
    structuredLog.info('alerting started', { rules: this.rules.length });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  evaluate(): void {
    const snap = this.metrics.snapshot();
    const now = Date.now();
    for (const rule of this.rules) {
      let total = 0;
      for (const [key, value] of Object.entries(snap.counters)) {
        if (key.startsWith(`${rule.metric}|`) || key === `${rule.metric}|`) {
          // For labeled result metrics, only count failure-ish series.
          if (rule.metric === 'onix_money_ops_total' || rule.metric === 'onix_worker_jobs_total') {
            if (!key.includes('result=error')) continue;
          }
          if (rule.metric === 'onix_idempotency_total') {
            if (!key.includes('result=conflict') && !key.includes('result=failed')) continue;
          }
          total += value;
        }
      }
      const baselineKey = rule.id;
      const prev = this.baselines.get(baselineKey);
      if (prev === undefined) {
        this.baselines.set(baselineKey, total);
        continue;
      }
      const delta = total - prev;
      // Sliding baseline every window: reset after evaluation window elapsed.
      const last = this.lastFired.get(`${baselineKey}:window`) ?? now;
      if (now - last >= rule.windowSec * 1000) {
        this.baselines.set(baselineKey, total);
        this.lastFired.set(`${baselineKey}:window`, now);
      }
      if (delta < rule.threshold) continue;
      const cooldownMs = Number(process.env.ALERT_COOLDOWN_MS ?? 300_000);
      const firedAt = this.lastFired.get(baselineKey) ?? 0;
      if (now - firedAt < cooldownMs) continue;
      this.lastFired.set(baselineKey, now);
      void this.fire(rule, delta);
    }
  }

  private async fire(rule: AlertRule, delta: number): Promise<void> {
    this.metrics.inc('onix_alerts_fired_total', { rule: rule.id, severity: rule.severity });
    const message = `ALERT ${rule.severity}: ${rule.description} (${rule.id}) delta=${delta} threshold=${rule.threshold}`;
    structuredLog.error(message, { alertId: rule.id, severity: rule.severity, delta });
    this.errors.capture(new Error(message), {
      tags: { alertId: rule.id, severity: rule.severity },
      level: rule.severity === 'critical' ? 'fatal' : 'warning',
    });
    if (!this.webhookUrl) return;
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: message,
          severity: rule.severity,
          rule,
          delta,
          service: process.env.OTEL_SERVICE_NAME ?? 'onix-api',
        }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch (err) {
      structuredLog.warn('alert webhook failed', { alertId: rule.id }, err);
    }
  }
}
