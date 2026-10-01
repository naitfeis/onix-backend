import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { BalanceService } from '../src/economy/wallet/balance.service';
import { ClawbackService } from '../src/economy/wallet/clawback.service';
import { ClawbackRecoverJob } from '../src/workers/jobs/clawback-recover.job';
import { RiskEngineService } from '../src/risk/risk-engine.service';
import { SecurityLockService } from '../src/risk/security-lock.service';
import { openClawbackDebtCents, spendableBalanceCents } from '../src/economy/wallet/sale-proceeds-hold';
import { hashPhone } from '../src/phone-hash';
import { SessionService } from '../src/auth-v2/session.service';
import { DeviceTrustService } from '../src/auth-v2/device-trust.service';
import { SigningKeyService } from '../src/auth-v2/signing-key.service';
import { EnvSecretsProvider } from '../src/auth-v2/secrets.provider';
import { generateEd25519PemPair, TokenService } from '../src/auth-v2/token.service';
import { MemoryCoordinationAdapter } from '../src/coordination/memory-coordination.adapter';
import { SharedCoordinationService } from '../src/coordination/shared-coordination.service';
import { MAX_SESSIONS_PER_USER } from '../src/auth-v2/session.constants';

/**
 * Real-DB drills for the fraud scenarios the owner asked to be attacked, not assumed:
 *
 *  1. The described lifecycle — cheat a buyer out of 1000 RUB, withdraw, get reported,
 *     owe a clawback debt WE DELIBERATELY DO NOT SHOW, then sell another lot for 2000.
 *  2. "10 people log into 1 account" — session flood against the real SessionService.
 *
 * Findings that changed the code are pinned as assertions so they cannot silently
 * regress. Like the other drills this refuses to fall back to DATABASE_URL.
 */
const databaseUrl = process.env.FRAUD_LIFECYCLE_DATABASE_URL?.trim();
const dbTest = databaseUrl ? test : test.skip;

/** 1000 RUB lot, platform fee 5% -> seller payout 950 RUB, already withdrawn. */
const PAYOUT_CENTS = 95_000n;
const LOT_CENTS = 100_000n;

type Harness = {
  prisma: PrismaClient;
  pool: Pool;
  userIds: bigint[];
  productIds: string[];
  orderIds: bigint[];
  sessionIds: string[];
};

async function harness(): Promise<Harness> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    ssl: databaseUrl?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  await prisma.$connect();
  return { prisma, pool, userIds: [], productIds: [], orderIds: [], sessionIds: [] };
}

async function close(h: Harness): Promise<void> {
  // FK order matters: clawback -> transitions -> order -> product -> user rows -> user.
  await h.prisma.orderClawback.deleteMany({ where: { sellerId: { in: h.userIds } } }).catch(() => undefined);
  if (h.orderIds.length) {
    await h.prisma.orderTransition.deleteMany({ where: { orderId: { in: h.orderIds } } }).catch(() => undefined);
    await h.prisma.order.deleteMany({ where: { id: { in: h.orderIds } } }).catch(() => undefined);
  }
  if (h.productIds.length) {
    await h.prisma.product.deleteMany({ where: { id: { in: h.productIds } } }).catch(() => undefined);
  }
  if (h.userIds.length) {
    // There is no RefreshToken table: the hash lives on Session.refreshTokenHash.
    await h.prisma.session.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.trustedDevice.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.authAuditLog.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.ledgerEntry.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.securityEvent.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.auditLog.deleteMany({ where: { entityId: { in: h.userIds.map(String) } } }).catch(() => undefined);
    // SupportTicketEvent cascades from SupportTicket, so deleting the ticket is enough.
    await h.prisma.supportTicket.deleteMany({ where: { reportedUserId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.notification.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.abuseMarker.deleteMany({ where: { sourceUserId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.user.deleteMany({ where: { id: { in: h.userIds } } }).catch(() => undefined);
  }
  await h.prisma.$disconnect();
  await h.pool.end();
}

/**
 * Sellers get a phoneHash so the phone gate (covered separately in phone-capture.test.ts)
 * does not mask the clawback behaviour under test.
 */
async function makeUser(h: Harness, label: string, balanceCents: bigint): Promise<bigint> {
  // A UUID suffix is hex, so telegramId (a BigInt column) needs digits-only randomness.
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const digits = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await h.prisma.user.create({
    data: {
      onixId: `FRD${suffix}`,
      displayName: `fraud drill ${label}`,
      balanceCents,
      telegramId: BigInt(`9${digits}`),
      phoneHash: hashPhone(`+7900${digits}`),
      phoneSharedAt: new Date(),
    },
  });
  h.userIds.push(user.id);
  return user.id;
}

async function makeOrder(
  h: Harness,
  buyerId: bigint,
  sellerId: bigint,
  amountCents: bigint,
  payoutCents: bigint,
  status: 'COMPLETED' | 'REFUNDED' = 'COMPLETED',
): Promise<bigint> {
  const product = await h.prisma.product.create({
    data: {
      title: `fraud drill lot ${randomUUID().slice(0, 8)}`,
      priceCents: amountCents,
      category: 'CS2',
      quantity: 1,
      status: 'SOLD_OUT',
      sellerId,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  h.productIds.push(product.id);
  const order = await h.prisma.order.create({
    data: {
      productId: product.id,
      buyerId,
      sellerId,
      totalAmountCents: amountCents,
      feeCents: amountCents - payoutCents,
      payoutCents,
      quantity: 1,
      status,
      completedAt: new Date(),
      idempotencyKey: `drill-${randomUUID()}`,
    },
  });
  h.orderIds.push(order.id);
  return order.id;
}

function services(h: Harness) {
  const balance = new BalanceService();
  const clawbacks = new ClawbackService(balance);
  const locks = new SecurityLockService(h.prisma as never);
  const risk = new RiskEngineService(h.prisma as never, undefined, locks);
  const recoverJob = new ClawbackRecoverJob(h.prisma as never, clawbacks);
  return { balance, clawbacks, locks, risk, recoverJob };
}

/**
 * The real refund path moves COMPLETED -> REFUNDED (escrow.module.ts writes
 * `status: target`), so fixtures must too: warrantyHeldSaleProceedsCents only scans
 * COMPLETED orders, and leaving a refunded order COMPLETED double-counts its payout.
 */
async function cheatAndRefund(
  h: Harness,
  label: string,
  sellerBalanceCents = 0n,
): Promise<{ seller: bigint; buyer: bigint; orderId: bigint }> {
  const { clawbacks } = services(h);
  const buyer = await makeUser(h, `${label}-buyer`, 0n);
  const seller = await makeUser(h, label, sellerBalanceCents);
  const orderId = await makeOrder(h, buyer, seller, LOT_CENTS, PAYOUT_CENTS, 'REFUNDED');
  await h.prisma.$transaction((tx) => clawbacks.clawbackOnRefund(tx, {
    orderId, sellerId: seller, amountCents: PAYOUT_CENTS, reason: 'Не выдал товар',
  }));
  return { seller, buyer, orderId };
}

dbTest('cheat -> withdraw -> refund: debt opens and stays INVISIBLE in the profile', async () => {
  const h = await harness();
  try {
    const { clawbacks } = services(h);
    const { seller, orderId } = await cheatAndRefund(h, 'invisible-debt');

    const row = await h.prisma.orderClawback.findUniqueOrThrow({ where: { orderId } });
    assert.equal(row.status, 'OPEN');
    assert.equal(row.amountCents, PAYOUT_CENTS);
    assert.equal(row.recoveredCents, 0n, 'the seller already withdrew, nothing to take');

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller },
      select: { withdrawBlockedAt: true, securityLockedAt: true, sellBannedAt: true },
    });
    assert.ok(user.withdrawBlockedAt, 'withdrawBlockedAt is set by the debt');
    // profiles.module.ts builds securityLock as `securityLockedAt ? {...} : { locked:false }`,
    // so the UI shows a clean profile: exactly the "we do not show him the debt" design.
    assert.equal(user.securityLockedAt, null, 'debt alone must not look like a security lock');
    assert.equal(user.sellBannedAt, null, 'debt alone must not ban selling');
    void clawbacks;

    const events = await h.prisma.securityEvent.findMany({
      where: { userId: seller, type: 'CLAWBACK_DEBT' }, select: { status: true },
    });
    assert.equal(events.length, 1, 'one internal signal for support, never shown to the seller');
    assert.equal(events[0]!.status, 'OPEN');
  } finally {
    await close(h);
  }
});

dbTest('new 2000 RUB sale: the 60s worker silently eats the debt — no lock, no message', async () => {
  const h = await harness();
  try {
    const { balance, recoverJob } = services(h);
    const { seller, orderId } = await cheatAndRefund(h, 'silent-recovery');
    assert.ok((await h.prisma.user.findUniqueOrThrow({ where: { id: seller } })).withdrawBlockedAt);

    // The seller publishes another lot; it sells for 2000 RUB -> 1900 RUB payout lands.
    await h.prisma.$transaction((tx) => balance.credit(tx, seller, 190_000n, 'SALE_PAYOUT', {
      idempotencyKey: `drill:silent:${orderId}`, description: 'Продажа 2000', source: 'SYSTEM',
      fundKind: 'SALE_PROCEEDS',
    }));

    // The scheduled job (WORKER_CLAWBACK_RECOVER_MS, default 60_000) runs on its own.
    assert.ok((await recoverJob.run()) >= 1, 'the worker recovered at least this debt');

    const row = await h.prisma.orderClawback.findUniqueOrThrow({ where: { orderId } });
    assert.equal(row.status, 'RECOVERED');
    assert.equal(row.recoveredCents, PAYOUT_CENTS);

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller },
      select: { balanceCents: true, withdrawBlockedAt: true, securityLockedAt: true },
    });
    assert.equal(user.balanceCents, 95_000n, '1900 - 950 debt = 950 left, silently');
    assert.equal(user.withdrawBlockedAt, null, 'block lifted automatically once repaid');
    assert.equal(user.securityLockedAt, null, 'no lock, no ban, no notification to the seller');

    const cleared = await h.prisma.auditLog.findFirst({
      where: { entityId: seller.toString(), action: 'CLAWBACK_DEBT_CLEARED' }, select: { id: true },
    });
    assert.ok(cleared, 'the repayment is audited for support even though the seller sees nothing');
  } finally {
    await close(h);
  }
});

dbTest('withdrawing with an UNPAID debt escalates to a full, appealable lock', async () => {
  const h = await harness();
  try {
    const { risk } = services(h);
    const { seller } = await cheatAndRefund(h, 'withdraw-lock');

    await assert.rejects(
      () => risk.assertWithdrawAllowed({ userId: seller, amountCents: 50_000n }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'AUTH_SECURITY_LOCK');
        return true;
      },
    );

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller },
      select: {
        securityLockedAt: true, sellBannedAt: true, suspiciousFundsHoldAt: true,
        securityCasePublicId: true, sessionVersion: true,
      },
    });
    assert.ok(user.securityLockedAt, 'securityLockedAt set -> profile now shows the lock');
    assert.ok(user.sellBannedAt, 'selling banned');
    assert.ok(user.suspiciousFundsHoldAt, 'spending frozen');
    assert.ok(user.securityCasePublicId, 'a public case id is issued for the appeal');
    assert.ok(user.sessionVersion >= 1, 'sessionVersion bumped so live sessions die');

    // The point of the fix: before it, the generic assertNotLocked fired first and the
    // seller got a dead-end "suspicious activity" error with caseId=null and no ticket.
    const event = await h.prisma.securityEvent.findFirst({
      where: { userId: seller, type: 'SECURITY_LOCK' }, select: { payload: true },
    });
    assert.ok(event, 'a security event records the escalation');
    const payload = event!.payload as { reasons?: string[] };
    assert.ok(
      (payload.reasons ?? []).some((r) => r.startsWith('unpaidClawbackCents=')),
      `support must see the debt amount, got: ${JSON.stringify(payload.reasons)}`,
    );

    const ticket = await h.prisma.supportTicket.findFirst({
      where: { reportedUserId: seller }, select: { publicNumber: true, subject: true },
    });
    assert.ok(ticket, 'an appeal ticket is opened automatically');
  } finally {
    await close(h);
  }
});

dbTest('an HONEST seller who can repay is not locked: debt settles before the risk gate', async () => {
  const h = await harness();
  try {
    const { risk, clawbacks } = services(h);
    // 1900 RUB on the balance, 950 RUB owed: the pre-gate settlement repays in full.
    const { seller } = await cheatAndRefund(h, 'honest-repay', 190_000n);

    // Repay the way withdraw() now does BEFORE assertWithdrawAllowed runs.
    await h.prisma.$transaction((tx) => clawbacks.recoverAllForSeller(tx, seller));

    const decision = await risk.assertWithdrawAllowed({ userId: seller, amountCents: 50_000n });
    assert.notEqual(decision.action, 'BLOCK', 'a solvent seller must not be blocked by a repaid debt');

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller },
      select: { securityLockedAt: true, withdrawBlockedAt: true, sellBannedAt: true },
    });
    assert.equal(user.securityLockedAt, null, 'no lock: the debt was real fraud debt but it is paid');
    assert.equal(user.withdrawBlockedAt, null, 'block cleared by repayment');
    assert.equal(user.sellBannedAt, null, 'selling never blocked');

    const debt = await h.prisma.$transaction((tx) => openClawbackDebtCents(tx, seller));
    assert.equal(debt, 0n);
  } finally {
    await close(h);
  }
});

dbTest('buying with an UNPAYABLE debt is blocked: money cannot be turned into goods', async () => {
  const h = await harness();
  try {
    const { risk } = services(h);
    // 100 RUB on the balance against a 950 RUB debt: the residue can never be repaid
    // by a purchase, so spending is frozen before the balance leaves the platform.
    const { seller } = await cheatAndRefund(h, 'buy-blocked', 10_000n);

    await assert.rejects(
      () => risk.assertPurchaseAllowed(seller, 5_000n),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'AUTH_SECURITY_LOCK');
        return true;
      },
      'an unpayable debt must lock spending',
    );

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller }, select: { securityLockedAt: true, suspiciousFundsHoldAt: true },
    });
    assert.ok(user.securityLockedAt, 'spending frozen -> the debt can no longer be outrun');
    assert.ok(user.suspiciousFundsHoldAt);
  } finally {
    await close(h);
  }
});

dbTest('a SOLVENT indebted seller can still buy: the debt row lags the balance by up to 60s', async () => {
  const h = await harness();
  try {
    const { balance, risk } = services(h);
    const { seller, orderId } = await cheatAndRefund(h, 'buy-solvent');
    await h.prisma.$transaction((tx) => balance.credit(tx, seller, 190_000n, 'SALE_PAYOUT', {
      idempotencyKey: `drill:buy:${orderId}`, description: 'Продажа 2000', source: 'SYSTEM',
      fundKind: 'SALE_PROCEEDS',
    }));

    // The OPEN clawback row only flips to RECOVERED when ClawbackRecoverJob runs, which
    // can be up to 60s later. Locking a seller who can plainly repay would punish them
    // for the worker's schedule — so the gate compares debt against the live balance.
    const debt = await h.prisma.$transaction((tx) => openClawbackDebtCents(tx, seller));
    assert.equal(debt, PAYOUT_CENTS, 'the debt row is still OPEN pending the worker');

    await risk.assertPurchaseAllowed(seller, 10_000n, h.prisma as never);

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller }, select: { securityLockedAt: true, suspiciousFundsHoldAt: true },
    });
    assert.equal(user.securityLockedAt, null, 'no lock for a debt the balance can cover');
    assert.equal(user.suspiciousFundsHoldAt, null);

    // The debt still reduces what is spendable, so the platform cannot be outrun.
    const spendable = await h.prisma.$transaction((tx) => spendableBalanceCents(tx, balance, seller));
    assert.equal(spendable, 95_000n, '1900 balance - 950 debt = 950 spendable');
  } finally {
    await close(h);
  }
});

dbTest('selling stays OPEN while indebted: banning sales would freeze the debt forever', async () => {
  const h = await harness();
  try {
    const { risk } = services(h);
    const { seller } = await cheatAndRefund(h, 'still-selling');

    // Recovery is repaid from FUTURE payouts by the 60s worker, so listings must stay live.
    await risk.assertSellAllowed(seller, 'Аккаунт Steam');

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller }, select: { sellBannedAt: true, securityLockedAt: true },
    });
    assert.equal(user.sellBannedAt, null, 'debt must not ban selling');
    assert.equal(user.securityLockedAt, null, 'and must not lock until money is moved');
  } finally {
    await close(h);
  }
});

dbTest('debt is subtracted from spendable balance on both the buy and withdraw paths', async () => {
  const h = await harness();
  try {
    const { balance } = services(h);
    const buyer = await makeUser(h, 'buyer5', 0n);
    const seller = await makeUser(h, 'spendable', 190_000n);
    // A still-in-warranty COMPLETED sale parks its payout as held proceeds.
    await makeOrder(h, buyer, seller, 200_000n, 190_000n, 'COMPLETED');
    // A REFUNDED order creates debt but is excluded from the warranty scan.
    const owedOrderId = await makeOrder(h, buyer, seller, LOT_CENTS, PAYOUT_CENTS, 'REFUNDED');

    const { clawbacks } = services(h);
    await h.prisma.$transaction(async (tx) => {
      // Drain the balance first so the clawback cannot be repaid instantly.
      await balance.debit(tx, seller, 190_000n, 'WITHDRAWAL', {
        idempotencyKey: `drill:drain:${owedOrderId}`, source: 'USER',
      });
      const res = await clawbacks.clawbackOnRefund(tx, {
        orderId: owedOrderId, sellerId: seller, amountCents: PAYOUT_CENTS, reason: 'Не выдал товар',
      });
      assert.equal(res.debitedCents, 0n, 'nothing left to take');
      assert.equal(res.remainingCents, PAYOUT_CENTS);
    });

    const debt = await h.prisma.$transaction((tx) => openClawbackDebtCents(tx, seller));
    assert.equal(debt, PAYOUT_CENTS, 'the full payout is owed');

    // Now a new sale lands: the debt eats it before the seller can spend a kopeck.
    await h.prisma.$transaction((tx) => balance.credit(tx, seller, 60_000n, 'SALE_PAYOUT', {
      idempotencyKey: `drill:partial:${owedOrderId}`, source: 'SYSTEM', fundKind: 'SALE_PROCEEDS',
    }));
    const spendable = await h.prisma.$transaction((tx) => spendableBalanceCents(tx, balance, seller));
    assert.equal(spendable, 0n, '600 RUB income against 950 RUB debt leaves nothing spendable');
  } finally {
    await close(h);
  }
});


dbTest('confirmed debt outranks the warranty hold, and spendable floors at zero', async () => {
  const h = await harness();
  try {
    const { balance, recoverJob } = services(h);
    const buyer = await makeUser(h, 'buyer6', 0n);
    const seller = await makeUser(h, 'warranty-clash', 0n);
    const owedOrderId = await makeOrder(h, buyer, seller, LOT_CENTS, PAYOUT_CENTS, 'REFUNDED');
    // A SECOND, still-in-warranty completed sale parks 1900 RUB as held proceeds.
    await makeOrder(h, buyer, seller, 200_000n, 190_000n, 'COMPLETED');

    const { clawbacks } = services(h);
    await h.prisma.$transaction(async (tx) => {
      await clawbacks.clawbackOnRefund(tx, {
        orderId: owedOrderId, sellerId: seller, amountCents: PAYOUT_CENTS, reason: 'Не выдал товар',
      });
      await balance.credit(tx, seller, 190_000n, 'SALE_PAYOUT', {
        idempotencyKey: `drill:warranty:${owedOrderId}`, description: 'Продажа 2000', source: 'SYSTEM',
        fundKind: 'SALE_PROCEEDS',
      });
    });

    await recoverJob.run();

    /**
     * recoverOpen debits getAvailable() (raw balanceCents), not spendableBalanceCents,
     * so a CONFIRMED debt (money owed to a defrauded buyer) is repaid ahead of a
     * POTENTIAL one (a warranty window that may or may not end in a refund). That
     * ordering is deliberate; what must hold is that the seller can never over-draw.
     */
    const debt = await h.prisma.$transaction((tx) => openClawbackDebtCents(tx, seller));
    assert.equal(debt, 0n, 'the confirmed debt is repaid in full');

    const row = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller }, select: { balanceCents: true },
    });
    assert.equal(row.balanceCents, 95_000n, '1900 - 950 repaid = 950 left');

    // Both reservations still apply, so the raw 950 is NOT spendable yet.
    const spendable = await h.prisma.$transaction((tx) => spendableBalanceCents(tx, balance, seller));
    assert.equal(spendable, 0n, 'hold + repaid debt leave nothing spendable — no over-draw');
  } finally {
    await close(h);
  }
});

/** Ed25519 keys are generated per run; SessionService signs real access tokens. */
function installKeys(): void {
  const pair = generateEd25519PemPair();
  process.env.AUTH_ED25519_CURRENT_KID = `drill-${randomUUID().slice(0, 8)}`;
  process.env.AUTH_ED25519_CURRENT_PRIVATE_PEM = pair.privatePem;
  process.env.AUTH_ED25519_CURRENT_PUBLIC_PEM = pair.publicPem;
}

function sessionService(h: Harness): SessionService {
  installKeys();
  const keys = new SigningKeyService(new EnvSecretsProvider());
  keys.clearCache();
  const tokens = new TokenService(keys);
  const coordination = new SharedCoordinationService(
    new MemoryCoordinationAdapter(),
    { backend: 'memory', instanceId: 'fraud-drill' },
  );
  const risk = new RiskEngineService(h.prisma as never, undefined, new SecurityLockService(h.prisma as never));
  return new SessionService(
    h.prisma as never, tokens, new DeviceTrustService(), risk as never, coordination as never,
  );
}

/** Ten different people, ten different devices, one account. */
function deviceFor(person: number) {
  return {
    browser: person % 2 === 0 ? 'chrome' : 'safari',
    os: person % 3 === 0 ? 'windows' : 'ios',
    platform: `platform-${person}`,
    browserId: `browser-${person}-${randomUUID().slice(0, 8)}`,
    pwaInstallId: `pwa-${person}-${randomUUID().slice(0, 8)}`,
    timezone: 'Europe/Moscow',
    language: 'ru',
    userAgent: `Mozilla/5.0 (drill person ${person})`,
  };
}

dbTest('ATTACK: 10 people in 1 account — oldest sessions die SILENTLY, nobody is locked', async () => {
  const h = await harness();
  try {
    const sessions = sessionService(h);
    const victim = await makeUser(h, 'shared-account', 0n);

    const created: string[] = [];
    for (let person = 0; person < MAX_SESSIONS_PER_USER; person += 1) {
      const res = await sessions.createSession({
        userId: victim, device: deviceFor(person), provider: 'TELEGRAM',
      });
      created.push(res.session.id);
      h.sessionIds.push(res.session.id);
    }

    // An 11th person arrives: the limit evicts the OLDEST active session.
    const intruder = await sessions.createSession({
      userId: victim, device: deviceFor(99), provider: 'TELEGRAM',
    });
    h.sessionIds.push(intruder.session.id);

    const active = await h.prisma.session.findMany({
      where: { userId: victim, revokedAt: null }, select: { id: true },
    });
    assert.equal(active.length, MAX_SESSIONS_PER_USER, 'the cap holds at 10 active sessions');
    assert.ok(active.some((s) => s.id === intruder.session.id), 'the newcomer stays logged in');

    const evicted = await h.prisma.session.findUniqueOrThrow({
      where: { id: created[0]! }, select: { revokedAt: true, revokeReason: true },
    });
    assert.ok(evicted.revokedAt, 'the legitimate owner session was revoked');
    assert.equal(evicted.revokeReason, 'SESSION_LIMIT');

    // FINDING: the eviction is audited but the user is never told. An attacker who can
    // reach the account can therefore evict the real owner repeatedly and invisibly.
    const audits = await h.prisma.authAuditLog.findMany({
      where: { userId: victim, action: 'SESSION_REVOKED' }, select: { metadata: true },
    });
    assert.ok(audits.length >= 1, 'the eviction is at least audited for support');

    const notifications = await h.prisma.notification.count({ where: { userId: victim } });
    assert.equal(notifications, 0, 'GAP: no notification warns the owner of the eviction');

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { id: victim }, select: { securityLockedAt: true, sellBannedAt: true },
    });
    assert.equal(user.securityLockedAt, null, 'GAP: 11 logins from 11 devices cause no lock');
    assert.equal(user.sellBannedAt, null);
  } finally {
    await close(h);
  }
});

dbTest('ATTACK: the evicted owner cannot use the old refresh token', async () => {
  const h = await harness();
  try {
    const sessions = sessionService(h);
    const victim = await makeUser(h, 'evicted-owner', 0n);

    const owner = await sessions.createSession({
      userId: victim, device: deviceFor(1), provider: 'TELEGRAM',
    });
    h.sessionIds.push(owner.session.id);
    for (let person = 2; person <= MAX_SESSIONS_PER_USER + 1; person += 1) {
      const res = await sessions.createSession({
        userId: victim, device: deviceFor(person), provider: 'TELEGRAM',
      });
      h.sessionIds.push(res.session.id);
    }

    const row = await h.prisma.session.findUniqueOrThrow({
      where: { id: owner.session.id }, select: { revokedAt: true },
    });
    assert.ok(row.revokedAt, 'the owner session is gone');

    // The revoked session's refresh token must not be able to mint a new one.
    const rotated = await sessions
      .rotateRefresh(owner.refreshToken, deviceFor(1))
      .then(() => 'rotated', (error: unknown) => (error as { code?: string }).code ?? 'error');
    assert.notEqual(rotated, 'rotated', 'an evicted refresh token must not come back to life');
  } finally {
    await close(h);
  }
});