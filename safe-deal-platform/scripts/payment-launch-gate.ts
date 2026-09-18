/**
 * Payment Launch Gate — must PASS before enabling real PSP money.
 *
 * Usage:
 *   npm run ops:payment-launch-gate
 *
 * Runs offline checks + webhook replay tests. Optional DB money-audit when
 * PAYMENT_GATE_REQUIRE_DB=1 and DATABASE_URL is set.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFiles } from '../src/env';

loadEnvFiles();

type Check = { name: string; pass: boolean; detail?: string };

const root = process.cwd();
const checks: Check[] = [];

function pass(name: string, detail?: string): void {
  checks.push({ name, pass: true, detail });
  console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name: string, detail?: string): void {
  checks.push({ name, pass: false, detail });
  console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
}

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

function fileContains(rel: string, needle: string | RegExp): boolean {
  const path = resolve(root, rel);
  if (!existsSync(path)) return false;
  const text = read(rel);
  return typeof needle === 'string' ? text.includes(needle) : needle.test(text);
}

function runNodeTest(globs: string[]): boolean {
  const r = spawnSync(
    'npx',
    ['tsx', '--test', ...globs],
    { cwd: root, encoding: 'utf8', env: process.env, shell: true },
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.status === 0;
}

// --- 1. Secrets audit ---
{
  const gitignore = existsSync(resolve(root, '.gitignore'))
    ? read('.gitignore')
    : '';
  if (gitignore.includes('.env')) pass('secrets audit: .env in .gitignore');
  else fail('secrets audit: .env in .gitignore');

  if (existsSync(resolve(root, '.env'))) {
    // Present locally is OK; must not be tracked. Best-effort git check.
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '.env'], {
      cwd: root, encoding: 'utf8',
    });
    if (tracked.status === 0) fail('secrets audit: .env not tracked in git', 'tracked!');
    else pass('secrets audit: .env not tracked in git');
  } else {
    pass('secrets audit: .env not tracked in git', 'no local .env');
  }
}

// --- 2. Webhook signature path exists ---
{
  const hasVerify = fileContains(
    'safe-deal-platform/src/economy/payments/payments.service.ts',
    'verifyWebhook',
  );
  const hasModel = fileContains(
    'safe-deal-platform/src/economy/payments/payment-webhook-model.ts',
    'INVALID_SIGNATURE',
  );
  if (hasVerify && hasModel) {
    pass('webhook signature verification', 'verifyWebhook + gate model');
  } else {
    fail('webhook signature verification', 'missing verifyWebhook or gate model');
  }
}

// --- 3. Credit only via ledger (no raw balance +=) ---
{
  const payments = read('safe-deal-platform/src/economy/payments/payments.service.ts');
  const bad = /balanceCents\s*\+\s*|balance\s*\+=/.test(payments);
  const good = payments.includes('this.balance.credit') || payments.includes('balance.credit');
  if (!bad && good) pass('ledger money-path (no raw balance +=)');
  else fail('ledger money-path (no raw balance +=)', bad ? 'raw increment found' : 'credit missing');
}

// --- 4. UNIQUE providerRef ---
{
  const schema = read('prisma/schema.prisma');
  const mig = existsSync(resolve(root, 'prisma/migrations/20260719180000_payment_provider_ref_unique/migration.sql'));
  if (schema.includes('@@unique([provider, providerRef])') && mig) {
    pass('providerPaymentId UNIQUE', 'provider + providerRef');
  } else {
    fail('providerPaymentId UNIQUE');
  }
}

// --- 5. Escrow transition table documented + enforced ---
{
  const escrow = read('safe-deal-platform/src/escrow.module.ts');
  const hasMachine = escrow.includes('PAYMENT_HOLD') && escrow.includes('SALE_PAYOUT');
  const blocksDouble = escrow.includes('idempotencyKey') || escrow.includes('OrderTransition');
  if (hasMachine && blocksDouble) pass('escrow transition machine');
  else fail('escrow transition machine');
}

// --- 6. Auth / cookie / CSRF / rate limits (static) ---
{
  const cookie = fileContains('safe-deal-platform/src/auth-v2/refresh-cookie.ts', 'HttpOnly')
    && fileContains('safe-deal-platform/src/auth-v2/refresh-cookie.ts', 'SameSite');
  const csrf = fileContains('safe-deal-platform/src/auth-v2/refresh-cookie.ts', 'assertCsrfHeader');
  const authRate = fileContains(
    'safe-deal-platform/src/auth-v2/auth-v2.controller.ts',
    /(?:assertRateLimit|rateLimit\.assert)/,
  );
  const rotate = fileContains('safe-deal-platform/src/auth-v2/auth-orchestrator.service.ts', 'RefreshRotated');
  if (cookie && csrf && authRate && rotate) {
    pass('production auth hardening', 'HttpOnly/SameSite/CSRF/rate-limit/refresh rotation');
  } else {
    fail('production auth hardening');
  }
}

// --- 6b. Telegram webhook durable update_id (gate before Telegram Wallet) ---
{
  const webhook = read('safe-deal-platform/src/login-challenge/bot-webhook.handler.ts');
  const provider = read('safe-deal-platform/src/economy/payments/payment-provider.ts');
  const hasUpdateIdem =
    webhook.includes("telegram:webhook")
    && webhook.includes('update_id')
    && webhook.includes('idempotency');
  const walletGate = provider.includes('HARD GATE') && provider.includes('Telegram Wallet');
  if (hasUpdateIdem && walletGate) {
    pass('telegram webhook update_id idempotency + Wallet hard gate');
  } else {
    fail('telegram webhook update_id idempotency + Wallet hard gate');
  }
}

// --- 7. Payment reconciliation job ---
{
  if (existsSync(resolve(root, 'safe-deal-platform/src/workers/jobs/payment-reconciliation.job.ts'))) {
    pass('payment reconciliation job present');
  } else {
    fail('payment reconciliation job present');
  }
}

// --- 8. Webhook replay + monetary gate tests ---
{
  const ok = runNodeTest([
    'safe-deal-platform/test/payment-webhook-gate.test.ts',
    'safe-deal-platform/test/ledger-property.test.ts',
    'safe-deal-platform/test/monetary-invariants.e2e.test.ts',
  ]);
  if (ok) pass('webhook replay + monetary invariants');
  else fail('webhook replay + monetary invariants', 'see test output above');
}

// --- 9. Optional live money-audit ---
{
  const requireDb = (process.env.PAYMENT_GATE_REQUIRE_DB ?? '').trim() === '1';
  const hasDb = Boolean((process.env.DATABASE_URL ?? '').trim());
  if (!requireDb) {
    pass('money audit (optional)', 'skipped — set PAYMENT_GATE_REQUIRE_DB=1 to require');
  } else if (!hasDb) {
    fail('money audit (required)', 'DATABASE_URL missing');
  } else {
    const r = spawnSync('npx', ['tsx', 'safe-deal-platform/scripts/money-audit.ts'], {
      cwd: root, encoding: 'utf8', env: process.env, shell: true,
    });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status === 0) pass('money audit (required)');
    else fail('money audit (required)');
  }
}

// --- 10. Real PSP not enabled silently ---
{
  const payments = read('safe-deal-platform/src/economy/payments/payments.service.ts');
  const blocksUnconfigured = payments.includes('ещё не подключён') || payments.includes('not configured');
  if (blocksUnconfigured) pass('production configuration: non-MANUAL PSP blocked until wired');
  else fail('production configuration: non-MANUAL PSP blocked until wired');
}

const failed = checks.filter((c) => !c.pass);
console.log('');
if (failed.length === 0) {
  console.log('PAYMENT LAUNCH GATE: PASS');
  process.exit(0);
}
console.log(`PAYMENT LAUNCH GATE: FAIL (${failed.length} checks)`);
for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
process.exit(1);
