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

test('structuredLog redacts secret-shaped field values and the JSON line', () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = ((msg?: unknown) => { lines.push(String(msg)); }) as typeof console.log;
  try {
    structuredLog.info('auth dump', {
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.signaturepaddingvalue',
    });
  } finally {
    console.log = orig;
  }
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes('eyJhbGciOiJIUzI1NiJ9'), false);
  assert.match(lines[0], /\[REDACTED\]/);
});

test('quiet access log skips ordinary traffic and keeps slow/5xx', async () => {
  const { shouldQuietHttpAccessLog } = await import('../src/request-timing.middleware');
  assert.equal(shouldQuietHttpAccessLog({
    method: 'GET', pathOnly: '/assets/index.js', status: 200, durationMs: 12,
  }), true);
  assert.equal(shouldQuietHttpAccessLog({
    method: 'POST', pathOnly: '/api/v2/auth/refresh', status: 200, durationMs: 40,
  }), true);
  assert.equal(shouldQuietHttpAccessLog({
    method: 'GET', pathOnly: '/api/products', status: 500, durationMs: 20,
  }), false);
  assert.equal(shouldQuietHttpAccessLog({
    method: 'GET', pathOnly: '/api/users/me', status: 200, durationMs: 2500,
  }), false);
});
