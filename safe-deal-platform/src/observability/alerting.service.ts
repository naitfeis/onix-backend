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
  /** When set, evaluate absolute gauge value instead of counter delta. */
  gauge?: boolean;
};

const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'http-5xx-burst',
    metric: 'onix_http_errors_total',
    threshold: 20,
    windowSec: 300,
    severity: 'critical',
    description: 'HTTP 5xx burst (~5% of traffic at modest load)',
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
  {
    id: 'reconciliation-mismatch',
    metric: 'onix_reconciliation_mismatch_events_total',
    threshold: 1,
    windowSec: 900,
    severity: 'critical',
    description: 'Ledger/deposit reconciliation mismatch',
  },
  {
    id: 'payment-reconciliation-gap',
    metric: 'onix_payment_reconciliation_gap_events_total',
    threshold: 1,
    windowSec: 300,
    severity: 'critical',
    description: 'Provider vs local PaymentIntent/Ledger gap (no auto-credit)',
  },
  {
    id: 'idempotency-conflicts',
    metric: 'onix_idempotency_total',
    threshold: 10,
    windowSec: 60,
    severity: 'warning',
    description: 'Idempotency conflicts / failures',
  },
  {
    id: 'clawback-open-alerts',
    metric: 'onix_clawback_open_alerts',
    threshold: 1,
    windowSec: 300,
    severity: 'critical',
    description: 'Open/stale clawback debt (platform float risk)',
    gauge: true,
  },
  {
    id: 'clawback-open-debt',
    metric: 'onix_clawback_open_debt_cents',
    threshold: Number(process.env.CLAWBACK_ALERT_MIN_CENTS ?? 50_000),
    windowSec: 300,
    severity: 'critical',
    description: 'Aggregate open clawback debt cents exceeds threshold',
    gauge: true,
  },
  {
    id: 'dispute-sla-stale',
    metric: 'onix_dispute_stale_count',
    threshold: 1,
    windowSec: 300,
    severity: 'critical',
    description: 'Stale DISPUTE orders past SLA',
    gauge: true,
  },
  {
    id: 'dispute-sla-breaches',
    metric: 'onix_dispute_sla_breach_events_total',
    threshold: 1,
    windowSec: 300,
    severity: 'critical',
    description: 'Dispute SLA breach events',
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
    structuredLog.info('alerting started', {
      rules: this.rules.length,
      webhookConfigured: Boolean(this.webhookUrl),
    });
    if (!this.webhookUrl) {
      structuredLog.warn('ALERT_WEBHOOK_URL unset — alerts log only (no paging)');
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Immediate page (workers) — respects cooldown + webhook. */
  async page(input: {
    id: string;
    severity: 'warning' | 'critical';
    description: string;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    const rule: AlertRule = {
      id: input.id,
      metric: `page:${input.id}`,
      threshold: 1,
      windowSec: 300,
      severity: input.severity,
      description: input.description,
    };
    const cooldownMs = Number(process.env.ALERT_COOLDOWN_MS ?? 300_000);
    const firedAt = this.lastFired.get(rule.id) ?? 0;
    if (Date.now() - firedAt < cooldownMs) return;
    this.lastFired.set(rule.id, Date.now());
    await this.fire(rule, 1, input.detail);
  }

  evaluate(): void {
    const snap = this.metrics.snapshot();
    const now = Date.now();
    for (const rule of this.rules) {
      if (rule.gauge) {
        let value = 0;
        for (const [key, v] of Object.entries(snap.gauges)) {
          if (key.startsWith(`${rule.metric}|`) || key === `${rule.metric}|`) {
            value = Math.max(value, v);
          }
        }
        if (value < rule.threshold) continue;
        const cooldownMs = Number(process.env.ALERT_COOLDOWN_MS ?? 300_000);
        const firedAt = this.lastFired.get(rule.id) ?? 0;
        if (now - firedAt < cooldownMs) continue;
        this.lastFired.set(rule.id, now);
        void this.fire(rule, value);
        continue;
      }

      let total = 0;
      for (const [key, value] of Object.entries(snap.counters)) {
        if (key.startsWith(`${rule.metric}|`) || key === `${rule.metric}|`) {
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

  private async fire(
    rule: AlertRule,
    delta: number,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    this.metrics.inc('onix_alerts_fired_total', { rule: rule.id, severity: rule.severity });
    const message = `ALERT ${rule.severity}: ${rule.description} (${rule.id}) delta=${delta} threshold=${rule.threshold}`;
    structuredLog.error(message, { alertId: rule.id, severity: rule.severity, delta, ...detail });
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
          detail: detail ?? null,
          service: process.env.OTEL_SERVICE_NAME ?? 'onix-api',
        }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch (err) {
      structuredLog.warn('alert webhook failed', { alertId: rule.id }, err);
    }
  }
}
