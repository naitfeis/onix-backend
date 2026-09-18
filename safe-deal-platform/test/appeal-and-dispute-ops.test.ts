import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoFile = (path: string) => readFileSync(path, 'utf8');

test('appeal SLA job pages on OPEN/IN_REVIEW only, not WAITING_USER', () => {
  const job = repoFile('safe-deal-platform/src/workers/jobs/appeal-sla.job.ts');
  assert.match(job, /APPEAL_SLA_BREACH/);
  assert.match(job, /status: \{ in: \['OPEN', 'IN_REVIEW'\] \}/);
  assert.doesNotMatch(job, /'OPEN', 'IN_REVIEW', 'WAITING_USER'/);
  assert.match(job, /category: \{ in: \['BAN_APPEAL', 'SELL_BAN_APPEAL'\] \}/);
});

test('appeal SLA config is shared between the lock message and the paging job', () => {
  const config = repoFile('safe-deal-platform/src/support-sla.config.ts');
  assert.match(config, /APPEAL_SLA_HOURS/);
  const job = repoFile('safe-deal-platform/src/workers/jobs/appeal-sla.job.ts');
  assert.match(job, /from '\.\.\/\.\.\/support-sla\.config'/);
  const risk = repoFile('safe-deal-platform/src/risk/risk-engine.service.ts');
  assert.match(risk, /appealSlaMessage/);
  assert.match(risk, /caseAppeal: true/);
});

test('appeal + dispute-digest jobs are wired into the worker runner and module', () => {
  const runner = repoFile('safe-deal-platform/src/workers/worker-runner.service.ts');
  assert.match(runner, /appeal-sla/);
  assert.match(runner, /this\.appealSla\.run\(\)/);
  assert.match(runner, /dispute-digest/);
  assert.match(runner, /this\.disputeDigest\.run\(\)/);
  const mod = repoFile('safe-deal-platform/src/workers/worker.module.ts');
  assert.match(mod, /AppealSlaJob/);
  assert.match(mod, /DisputeDigestJob/);
});

test('dispute SLA job applies a tighter SLA to high-value disputes', () => {
  const job = repoFile('safe-deal-platform/src/workers/jobs/dispute-sla.job.ts');
  assert.match(job, /DISPUTE_SLA_HIGH_VALUE_DAYS/);
  assert.match(job, /DISPUTE_SLA_HIGH_VALUE_CENTS/);
  assert.match(job, /function slaDaysFor/);
});

test('dispute daily digest gates on a single UTC hour and does not resend same-day', () => {
  const job = repoFile('safe-deal-platform/src/workers/jobs/dispute-digest.job.ts');
  assert.match(job, /digestHourUtc/);
  assert.match(job, /isSameUtcDay/);
  assert.match(job, /status: 'DISPUTE'/);
});

test('support ticket claim/release avoids a schema change (uses SupportTicketEvent kind)', () => {
  const svc = repoFile('safe-deal-platform/src/support-center.service.ts');
  assert.match(svc, /async claimTicket\(/);
  assert.match(svc, /async releaseTicket\(/);
  assert.match(svc, /kind: 'CLAIMED'/);
  assert.match(svc, /kind: 'UNCLAIMED'/);
  assert.match(svc, /SupportTicket.*FOR UPDATE/);
  assert.match(svc, /this\.prisma\.\$transaction\(async \(tx\)/);
  const controller = repoFile('safe-deal-platform/src/admin/admin.controller.ts');
  assert.match(controller, /support\/tickets\/:id\/claim/);
  assert.match(controller, /support\/tickets\/:id\/release/);
});

test('appeal response carries slaHours end to end (backend + frontend toast)', () => {
  const svc = repoFile('safe-deal-platform/src/support-center.service.ts');
  assert.match(svc, /slaHours: appealSlaHours\(\)/);
  const profile = repoFile('onix-frontend/src/screens/Profile.tsx');
  assert.match(profile, /slaHours/);
});
