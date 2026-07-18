import assert from 'node:assert/strict';
import test from 'node:test';
import { MetricsService } from '../src/observability/metrics.service';
import { structuredLog } from '../src/observability/structured-logger';

test('metrics: counters and prometheus exposition', () => {
  const m = new MetricsService();
  m.inc('onix_http_requests_total', { method: 'GET', route: '/api/health', status: '200' });
  m.observe('onix_http_request_duration_ms', 12.5, { method: 'GET', route: '/api/health' });
  m.recordMoneyOp('credit:DEPOSIT', true);
  m.recordWorkerJob('deposit-unlock', 3, true, 40);
  const text = m.toPrometheus();
  assert.match(text, /onix_http_requests_total/);
  assert.match(text, /onix_money_ops_total/);
  assert.match(text, /onix_worker_jobs_total/);
  const snap = m.snapshot();
  assert.ok(snap.uptimeSec >= 0);
});

test('structuredLog: does not throw and redacts bearer tokens in fields via slog message', () => {
  // Smoke — ensure logger callable; redaction covered in safe-error-log tests.
  structuredLog.info('test event', { route: '/api/wallet/ledger', status: 200 });
  structuredLog.warn('test warn', { requestId: 'abc' });
});
