import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * Explicit answer to the audit question:
 * CI "42 green" monetary/concurrency tests use in-memory LedgerModel unless
 * RUN_DB_CONCURRENCY=1 / ops:db-concurrency-drill against real Postgres.
 */
test('launch-blockers-money tests are in-memory LedgerModel (documented)', () => {
  const src = readFileSync('safe-deal-platform/test/launch-blockers-money.test.ts', 'utf8');
  assert.match(src, /LedgerModel/);
  assert.match(src, /in-memory|pure model|DB-backed/i);
  assert.doesNotMatch(src, /new PrismaClient|DATABASE_URL/);
});

test('product stock uses conditional UPDATE quantity gte (DB race primitive)', () => {
  const stock = readFileSync('safe-deal-platform/src/economy/wallet/product-stock.ts', 'utf8');
  assert.match(stock, /quantity:\s*\{\s*gte:/);
  assert.match(stock, /updateMany/);
});

test('dispute SLA worker is wired', () => {
  const job = readFileSync('safe-deal-platform/src/workers/jobs/dispute-sla.job.ts', 'utf8');
  const runner = readFileSync('safe-deal-platform/src/workers/worker-runner.service.ts', 'utf8');
  assert.match(job, /DISPUTE_SLA_BREACH/);
  assert.match(job, /DISPUTE_SLA_DAYS/);
  assert.match(runner, /dispute-sla/);
  assert.match(runner, /disputeSla/);
});

test('money alerts page clawback/float and require webhook awareness', () => {
  const alerting = readFileSync('safe-deal-platform/src/observability/alerting.service.ts', 'utf8');
  const recon = readFileSync('safe-deal-platform/src/workers/jobs/ledger-reconciliation.job.ts', 'utf8');
  assert.match(alerting, /clawback-open-debt/);
  assert.match(alerting, /gauge:\s*true/);
  assert.match(alerting, /async page\(/);
  assert.match(alerting, /ALERT_WEBHOOK_URL unset/);
  assert.match(recon, /clawback-platform-float/);
  assert.match(recon, /onix_platform_float_clawback_cents/);
});
