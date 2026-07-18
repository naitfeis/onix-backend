import { Injectable } from '@nestjs/common';

type Labels = Record<string, string>;

function labelKey(labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

/**
 * Process-local Prometheus-compatible metrics (no external agent required).
 * Exposed at GET /api/metrics. Workers share the same shapes via separate process.
 */
@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();
  private readonly startedAt = Date.now();

  constructor() {
    this.gauge('onix_process_up', 1);
  }

  inc(name: string, labels?: Labels, by = 1): void {
    const key = `${name}|${labelKey(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  gauge(name: string, value: number, labels?: Labels): void {
    const key = `${name}|${labelKey(labels)}`;
    this.gauges.set(key, value);
  }

  observe(name: string, valueMs: number, labels?: Labels): void {
    const key = `${name}|${labelKey(labels)}`;
    const arr = this.histograms.get(key) ?? [];
    arr.push(valueMs);
    // Cap samples to bound memory under load tests.
    if (arr.length > 2_000) arr.splice(0, arr.length - 2_000);
    this.histograms.set(key, arr);
  }

  /** Convenience: HTTP request accounting. */
  recordHttp(method: string, route: string, status: number, durationMs: number): void {
    const labels = {
      method: method.toUpperCase(),
      route: route.slice(0, 120),
      status: String(status),
    };
    this.inc('onix_http_requests_total', labels);
    this.observe('onix_http_request_duration_ms', durationMs, labels);
    if (status >= 500) this.inc('onix_http_errors_total', { method: labels.method, route: labels.route });
  }

  recordMoneyOp(op: string, ok: boolean): void {
    this.inc('onix_money_ops_total', { op, result: ok ? 'ok' : 'error' });
  }

  recordWorkerJob(job: string, processed: number, ok: boolean, durationMs: number): void {
    this.inc('onix_worker_jobs_total', { job, result: ok ? 'ok' : 'error' });
    this.inc('onix_worker_items_processed_total', { job }, processed);
    this.observe('onix_worker_job_duration_ms', durationMs, { job });
  }

  snapshot(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, { count: number; sum: number; p95: number }>;
    uptimeSec: number;
  } {
    const histograms: Record<string, { count: number; sum: number; p95: number }> = {};
    for (const [key, samples] of this.histograms) {
      const sorted = [...samples].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0;
      histograms[key] = { count: sorted.length, sum, p95 };
    }
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  /** Prometheus text exposition format. */
  toPrometheus(): string {
    this.gauge('onix_process_uptime_seconds', Math.floor((Date.now() - this.startedAt) / 1000));
    const lines: string[] = [];
    const emit = (name: string, labels: string, value: number, help?: string, type?: string) => {
      if (help) lines.push(`# HELP ${name} ${help}`);
      if (type) lines.push(`# TYPE ${name} ${type}`);
      const lbl = labels ? `{${labels}}` : '';
      lines.push(`${name}${lbl} ${value}`);
    };

    const seenHelp = new Set<string>();
    for (const [key, value] of this.counters) {
      const [name, labelStr] = key.split('|');
      const labels = (labelStr ?? '')
        .split(',')
        .filter(Boolean)
        .map((pair) => {
          const [k, ...rest] = pair.split('=');
          return `${k}="${escapeLabel(rest.join('='))}"`;
        })
        .join(',');
      if (!seenHelp.has(name!)) {
        emit(name!, labels, value, `${name} counter`, 'counter');
        seenHelp.add(name!);
      } else {
        lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);
      }
    }
    for (const [key, value] of this.gauges) {
      const [name, labelStr] = key.split('|');
      const labels = (labelStr ?? '')
        .split(',')
        .filter(Boolean)
        .map((pair) => {
          const [k, ...rest] = pair.split('=');
          return `${k}="${escapeLabel(rest.join('='))}"`;
        })
        .join(',');
      if (!seenHelp.has(name!)) {
        emit(name!, labels, value, `${name} gauge`, 'gauge');
        seenHelp.add(name!);
      } else {
        lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);
      }
    }
    for (const [key, samples] of this.histograms) {
      const [name, labelStr] = key.split('|');
      const labels = (labelStr ?? '')
        .split(',')
        .filter(Boolean)
        .map((pair) => {
          const [k, ...rest] = pair.split('=');
          return `${k}="${escapeLabel(rest.join('='))}"`;
        })
        .join(',');
      const sum = samples.reduce((a, b) => a + b, 0);
      const base = labels ? `{${labels}}` : '';
      const countName = `${name}_count`;
      const sumName = `${name}_sum`;
      if (!seenHelp.has(name!)) {
        lines.push(`# HELP ${name} ${name} histogram (ms)`);
        lines.push(`# TYPE ${name} summary`);
        seenHelp.add(name!);
      }
      lines.push(`${countName}${base} ${samples.length}`);
      lines.push(`${sumName}${base} ${sum}`);
    }
    return `${lines.join('\n')}\n`;
  }
}
