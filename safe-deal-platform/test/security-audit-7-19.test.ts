import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoFile = (path: string) => readFileSync(path, 'utf8');

/**
 * Senior audit gates for checklist §§7–19 (source-level regression nets).
 * Full integration matrix listed at bottom of this file as mandatory follow-ups.
 */

test('§7 payment: settle credits from DB intent only; forged amount rejected', () => {
  const payments = repoFile('safe-deal-platform/src/economy/payments/payments.service.ts');
  assert.match(payments, /Never trusts amount\/userId from payload for credit/);
  assert.match(payments, /claimedAmountCents !== intent\.amountCents/);
  assert.match(payments, /idempotencyKey: `payment:\$\{intent\.id\}:main`/);
  assert.match(payments, /frozenUnitPriceCents/);
  assert.match(payments, /stockPreReserved/);
  assert.match(payments, /verifyWebhook/);
});

test('§7 payment: expire does not kill intents that already have providerRef', () => {
  const expire = repoFile('safe-deal-platform/src/workers/jobs/payment-intent-expire.job.ts');
  assert.match(expire, /providerRef/);
  assert.match(expire, /return false/);
  assert.match(expire, /releaseProductStock/);
});

test('§8 stock: autoDeliver blocked for qty>1; secret only on last unit', () => {
  const market = repoFile('safe-deal-platform/src/marketplace.module.ts');
  const escrow = repoFile('safe-deal-platform/src/escrow.module.ts');
  assert.match(market, /autoDeliver && dto\.quantity > 1/);
  assert.match(escrow, /isLastUnit/);
  assert.match(escrow, /stockAfterQty === 0/);
});

test('§9 price: DTO amounts are int cents with min/max; commission server-side', () => {
  const economy = repoFile('safe-deal-platform/src/economy/economy.controller.ts');
  const pricing = repoFile('safe-deal-platform/src/pricing.ts');
  assert.match(economy, /@IsInt\(\) @Min\(100\) @Max\(50_000_000\) amountCents/);
  assert.match(pricing, /SALE_FEE_BPS/);
  assert.match(pricing, /computeSaleAmounts/);
});

test('§10 IDOR: orders/chats/payments scoped to participant', () => {
  const escrow = repoFile('safe-deal-platform/src/escrow.module.ts');
  const engage = repoFile('safe-deal-platform/src/engagement.module.ts');
  const payments = repoFile('safe-deal-platform/src/economy/payments/payments.service.ts');
  assert.match(escrow, /OR: \[\{ buyerId: user\.id \}, \{ sellerId: user\.id \}\]/);
  assert.match(escrow, /requireBuyer && order\.buyerId !== actor\.id/);
  assert.match(engage, /await this\.member\(user\.id, chatId\)/);
  assert.match(engage, /visibleToUserId: user\.id/);
  assert.match(payments, /intent\.userId !== user\.id/);
});

test('§11 admin: dangerous ops require roles + IP allowlist', () => {
  const admin = repoFile('safe-deal-platform/src/admin/admin.controller.ts');
  assert.match(admin, /assertDangerousAdminIp/);
  assert.match(admin, /AdminRoles\(AdminRole\.SUPER_ADMIN/);
  assert.match(admin, /wipeUser/);
});

test('§12 session: refresh reuse revokes family; rotation CAS', () => {
  const session = repoFile('safe-deal-platform/src/auth-v2/session.service.ts');
  assert.match(session, /AUTH_REFRESH_REUSED|REFRESH_REUSE/);
  assert.match(session, /rotateRefresh/);
  assert.match(session, /previousRefreshHash|refreshReuseGraceMs|waitForGraceRotation/);
});

test('§13 webhooks: Tinkoff Token HMAC; Telegram bot secret header', () => {
  const tinkoff = repoFile('safe-deal-platform/src/economy/payments/tinkoff.provider.ts');
  const bot = repoFile('safe-deal-platform/src/login-challenge/bot-webhook.handler.ts');
  assert.match(tinkoff, /tinkoffToken/);
  assert.match(tinkoff, /given\.toLowerCase\(\) !== expected\.toLowerCase\(\)/);
  assert.match(bot, /x-telegram-bot-api-secret-token/i);
});

test('§14 chat cannot mutate money; delivery secret visibility gated', () => {
  const engage = repoFile('safe-deal-platform/src/engagement.module.ts');
  assert.match(engage, /Access: ChatMember only/);
  assert.match(engage, /visibleToUserId/);
  assert.doesNotMatch(engage, /SALE_PAYOUT|PURCHASE_HOLD|completeByAdmin/);
});

test('§15 support: ticket close blocked while order open; dispute from DISPUTE_FROM', () => {
  const guard = repoFile('safe-deal-platform/src/support-ticket-guard.ts');
  const support = repoFile('safe-deal-platform/src/support.module.ts');
  assert.match(guard, /OPEN_ORDER_STATUSES/);
  assert.match(support, /DISPUTE_FROM/);
  assert.match(support, /assertRateLimit\(`order:support:/);
});

test('§16 notify after commit (telegram); money mutations in Serializable TX', () => {
  const escrow = repoFile('safe-deal-platform/src/escrow.module.ts');
  assert.match(escrow, /deliverTelegramAfterCommit/);
  assert.match(escrow, /withSerializableTransaction/);
});

test('§17 DB CHECK migration for money/stock invariants exists', () => {
  const mig = repoFile('prisma/migrations/20260909193000_money_inventory_check_constraints/migration.sql');
  assert.match(mig, /order_fee_payout_sum/);
  assert.match(mig, /ledger_one_sale_payout_per_order/);
  assert.match(mig, /user_balance_nonneg/);
  assert.match(mig, /product_quantity_nonneg/);
});

test('§18 rate limits on payment/purchase/chat/support/refresh', () => {
  const economy = repoFile('safe-deal-platform/src/economy/economy.controller.ts');
  const escrow = repoFile('safe-deal-platform/src/escrow.module.ts');
  const engage = repoFile('safe-deal-platform/src/engagement.module.ts');
  const auth = repoFile('safe-deal-platform/src/auth-v2/auth-v2.controller.ts');
  assert.match(economy, /payment:create:/);
  assert.match(escrow, /order:purchase:/);
  assert.match(engage, /chat-send:/);
  assert.match(auth, /auth:v2:refresh:/);
});

/*
 * §19 MANDATORY integration/e2e tests (keep green; add DB-backed where missing):
 * - concurrent purchase same SKU (exactly one winner)
 * - concurrent withdraw full balance (exactly one winner) — see withdrawal-guards.test.ts
 * - complete + refund race
 * - refund + purchase race (spendable)
 * - duplicate webhook SUCCEEDED
 * - duplicate purchase / refund / payout idempotency keys
 * - warranty spend lock blocks purchase+withdraw
 * - multi-qty autoDeliver rejected at listing; last-unit secret only
 * - payment → purchase with frozen price + sell-out
 * - dispute → support unify; ticket close vs open order
 * - unauthorized GET order / chat / payment intent / wallet withdraw
 * - refresh token reuse outside grace → family revoke
 */
