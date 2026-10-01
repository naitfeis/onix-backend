import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { EscrowService } from '../src/escrow.module';
import { BalanceService } from '../src/economy/wallet/balance.service';
import { ClawbackService } from '../src/economy/wallet/clawback.service';
import { FraudWatchService } from '../src/risk/fraud-watch.service';
import { RiskScoreService } from '../src/risk-score.service';
import { DeviceTrustService } from '../src/auth-v2/device-trust.service';
import { IdentityService } from '../src/auth-v2/identity.service';
import { AdminSecurityService } from '../src/admin/admin-security.service';
import { WithdrawVelocityService } from '../src/economy/wallet/withdraw-velocity';
import { TrustService } from '../src/economy/trust/trust.service';
import { banDurationDaysForStrike } from '../src/ban-policy';
import { ensurePairChat } from '../src/chat-pair';
import type { AuthUser } from '../src/common';
import type { RiskDeviceInput } from '../src/risk-score.service';

/**
 * "Do not ban yet - wait for the money."
 *
 * Scenario the platform had no answer for: a confirmed fraud complaint against an account
 * with a ZERO balance. Banning immediately repays nobody and just pushes the seller onto a
 * fresh account, so the debt dies with the tombstone. The admin fraud marker instead keeps
 * selling OPEN and intercepts the first sale payout: the declared victim is repaid, the
 * remainder is frozen, and the account is banned automatically with strike escalation.
 *
 * Also drills the questions that decide whether this survives real abuse:
 * - a DEPOSIT must not trigger it (own money is not fraud proceeds);
 * - the ban must still be reachable after an IP change (FINGERPRINT excludes IP);
 * - repeat bans must escalate instead of restarting the same window.
 *
 * Refuses to fall back to DATABASE_URL, like every other drill here.
 */
const databaseUrl = process.env.FRAUD_LIFECYCLE_DATABASE_URL?.trim();
const dbTest = databaseUrl ? test : test.skip;

/** 1000 RUB - the amount in the scenario that motivated the feature. */
const SCAM_CENTS = 100_000n;
const LOT_CENTS = 50_000n;
const FEE_CENTS = 2_500n;
const PAYOUT_CENTS = LOT_CENTS - FEE_CENTS;
void PAYOUT_CENTS;

type Harness = {
  prisma: PrismaClient;
  pool: Pool;
  escrow: EscrowService;
  fraudWatch: FraudWatchService;
  admin: AdminSecurityService;
  risk: RiskScoreService;
  identity: IdentityService;
  deviceTrust: DeviceTrustService;
  trust: TrustService;
  userIds: bigint[];
  adminUserIds: bigint[];
  productIds: string[];
  orderIds: bigint[];
  markerIds: string[];
};

function adminActor(id: bigint) {
  return { id, email: 'drill@onix.local', role: 'SUPER_ADMIN' as const, sessionId: 'drill' };
}

function actor(userId: bigint): AuthUser {
  return { id: userId, telegramId: null, onixId: 'FW-000000', isAdmin: false, isSupport: false };
}

/**
 * A support actor so completeByAdmin accepts the call. canActAsSupport gates on the
 * dedicated `adminEscrow` flag, not on isAdmin/isSupport — money actions are separated
 * from staff viewing on purpose, so the drill must present the right capability.
 */
function supportActor(userId: bigint): AuthUser {
  return {
    id: userId, telegramId: null, onixId: 'FW-000000',
    isAdmin: true, isSupport: true, adminEscrow: true,
  };
}
async function harness(): Promise<Harness> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    ssl: databaseUrl?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  await prisma.$connect();

  const balance = new BalanceService();
  const clawbacks = new ClawbackService(balance);
  const deviceTrust = new DeviceTrustService();
  const risk = new RiskScoreService(deviceTrust, prisma as never);
  const fraudWatch = new FraudWatchService(prisma as never, balance, risk);
  const identity = new IdentityService(risk);
  const trust = new TrustService(prisma as never);
  const admin = new AdminSecurityService(
    prisma as never,
    new WithdrawVelocityService(prisma as never),
    balance,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    risk,
  );
  const escrow = new EscrowService(
    prisma as never,
    balance,
    clawbacks,
    // Only the payout path matters here: deposit freeze / realtime / support are stubs.
    { lockOnSaleComplete: async () => null, releaseForOrder: async () => null } as never,
    { publish: () => undefined } as never,
    { open: async () => undefined } as never,
    undefined,
    fraudWatch,
  );
  const adminUser = await prisma.adminUser.create({
    data: { email: `fw-${randomUUID()}@onix.local`, passwordHash: 'x'.repeat(60), role: 'SUPER_ADMIN' },
  });

  return {
    prisma, pool, escrow, fraudWatch, admin, risk, identity, deviceTrust, trust,
    userIds: [], adminUserIds: [adminUser.id], productIds: [], orderIds: [], markerIds: [],
  };
}

async function close(h: Harness): Promise<void> {
  await h.prisma.adminActionLog.deleteMany({
    where: { adminUserId: { in: h.adminUserIds } },
  }).catch(() => undefined);
  await h.prisma.adminUser.deleteMany({ where: { id: { in: h.adminUserIds } } }).catch(() => undefined);
  await h.prisma.orderClawback.deleteMany({ where: { sellerId: { in: h.userIds } } }).catch(() => undefined);
  if (h.orderIds.length) {
    await h.prisma.orderTransition.deleteMany({
      where: { orderId: { in: h.orderIds } },
    }).catch(() => undefined);
    await h.prisma.order.deleteMany({ where: { id: { in: h.orderIds } } }).catch(() => undefined);
  }
  if (h.productIds.length) {
    await h.prisma.product.deleteMany({ where: { id: { in: h.productIds } } }).catch(() => undefined);
  }
  if (h.userIds.length) {
    await h.prisma.abuseMarker.deleteMany({ where: { sourceUserId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.message.deleteMany({
      where: { chat: { members: { some: { userId: { in: h.userIds } } } } },
    }).catch(() => undefined);
    await h.prisma.chatMember.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.chat.deleteMany({
      where: { members: { some: { userId: { in: h.userIds } } } },
    }).catch(() => undefined);
    await h.prisma.session.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.identityLink.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.identityHistory.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.trustHistoryEvent.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.ledgerEntry.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.notification.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.auditLog.deleteMany({ where: { actorId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.securityEvent.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.user.deleteMany({ where: { id: { in: h.userIds } } }).catch(() => undefined);
  }
  await h.prisma.$disconnect();
  await h.pool.end();
}

async function makeUser(h: Harness, label: string, balanceCents = 0n): Promise<bigint> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const digits = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await h.prisma.user.create({
    data: {
      onixId: `FW${suffix}`,
      displayName: `fraud watch drill ${label}`,
      balanceCents,
      telegramId: BigInt(`9${digits}`),
    },
  });
  h.userIds.push(user.id);
  return user.id;
}

async function onixOf(h: Harness, userId: bigint): Promise<string> {
  return (await h.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { onixId: true } })).onixId;
}

/** Stable device bundle; IP is a parameter because IP rotation is one of the scenarios. */
function deviceFor(person: string, ip = '203.0.113.7'): RiskDeviceInput {
  return {
    browser: 'chrome',
    os: 'windows',
    platform: 'windows',
    browserId: `browser-${person}`,
    pwaInstallId: `pwa-${person}`,
    timezone: 'Europe/Moscow',
    language: 'ru',
    userAgent: `Mozilla/5.0 (drill ${person})`,
    ipAddress: ip,
  };
}

async function login(h: Harness, userId: bigint, device: RiskDeviceInput): Promise<string> {
  const fingerprintHash = h.deviceTrust.resolveDeviceId(device);
  assert.ok(fingerprintHash, 'the device bundle must derive a stable fingerprint');
  await h.prisma.session.create({
    data: {
      userId,
      fingerprintHash,
      ipAddress: device.ipAddress ?? null,
      userAgent: device.userAgent ?? null,
      browser: device.browser ?? null,
      os: device.os ?? null,
      familyId: randomUUID(),
      refreshTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
      refreshExpiresAt: new Date(Date.now() + 86_400_000),
      absoluteExpiresAt: new Date(Date.now() + 7 * 86_400_000),
      lastSeenAt: new Date(),
    },
  });
  return fingerprintHash!;
}

/**
 * A lot in DELIVERING with the buyer's money held - the state completion pays out from.
 */
async function pendingSale(h: Harness, label: string, sellerId: bigint) {
  const balance = new BalanceService();
  const buyer = await makeUser(h, `${label}-buyer`, LOT_CENTS);
  const product = await h.prisma.product.create({
    data: {
      title: `fraud watch ${label} ${randomUUID().slice(0, 8)}`,
      priceCents: LOT_CENTS, category: 'STEAM', quantity: 0, status: 'SOLD_OUT',
      sellerId, expiresAt: new Date(Date.now() + 86_400_000), warrantyHours: 10,
    },
  });
  h.productIds.push(product.id);
  const chat = await h.prisma.$transaction((tx) => ensurePairChat(tx, buyer, sellerId));
  const order = await h.prisma.order.create({
    data: {
      productId: product.id, buyerId: buyer, sellerId, chatId: chat.id,
      totalAmountCents: LOT_CENTS, feeCents: FEE_CENTS, payoutCents: PAYOUT_CENTS, quantity: 1,
      status: 'DELIVERING', idempotencyKey: `fw-${randomUUID()}`,
    },
  });
  h.orderIds.push(order.id);
  await h.prisma.$transaction((tx) => balance.debit(tx, buyer, LOT_CENTS, 'PURCHASE_HOLD', {
    idempotencyKey: `fw-hold-${order.id}`, description: 'Покупка', source: 'SYSTEM',
  }));
  return { buyer, orderId: order.id, payoutCents: PAYOUT_CENTS };
}
// ---------------------------------------------------------------------------
// 1. The motivating scenario: scam -> complaint -> no money -> marker, no ban.
// ---------------------------------------------------------------------------
dbTest('confirmed fraud with an empty balance: marker arms, account is NOT banned, selling stays OPEN', async () => {
  const h = await harness();
  try {
    const scammer = await makeUser(h, 'scammer');
    const victim = await makeUser(h, 'victim');
    await login(h, scammer, deviceFor('fw-scammer'));

    const armed = await h.admin.setFraudWatch(adminActor(h.adminUserIds[0]), await onixOf(h, scammer), {
      comment: 'Обманул покупателя на 1000 рублей, товар не выдал',
      victimOnixId: await onixOf(h, victim),
      claimCents: SCAM_CENTS.toString(),
    });
    assert.equal(armed.fraudWatch, true);

    const row = await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer },
      select: {
        deletedAt: true, bannedAt: true, fraudWatchAt: true, fraudWatchVictimUserId: true,
        fraudWatchClaimCents: true, sellBannedAt: true, withdrawBlockedAt: true,
      },
    });
    // The whole point: no ban yet, because there is nothing to repay with.
    assert.equal(row.deletedAt, null, 'the account must NOT be banned while waiting for money');
    assert.equal(row.bannedAt, null);
    assert.ok(row.fraudWatchAt, 'the marker is armed');
    assert.equal(row.fraudWatchVictimUserId, victim);
    assert.equal(row.fraudWatchClaimCents, SCAM_CENTS);
    // Selling must stay open, otherwise the debt can never be repaid.
    assert.equal(row.sellBannedAt, null, 'selling stays OPEN so the seller can still earn');
    assert.equal(row.withdrawBlockedAt, null, 'nothing is frozen before the money arrives');

    // Markers are armed IMMEDIATELY, not at trigger time: otherwise the seller abandons
    // this account and registers a replacement before ever selling.
    const markers = await h.prisma.abuseMarker.findMany({
      where: { sourceUserId: scammer, revokedAt: null }, select: { kind: true },
    });
    const kinds = new Set(markers.map((m) => m.kind));
    assert.ok(kinds.has('FINGERPRINT'), 'device marker armed at watch time');
    assert.ok(kinds.has('TELEGRAM_ID'), 'telegram marker armed at watch time');
  } finally {
    await close(h);
  }
});

dbTest('the marker fires on the first sale payout: victim repaid, remainder frozen, account banned', async () => {
  const h = await harness();
  try {
    const scammer = await makeUser(h, 'scammer');
    const victim = await makeUser(h, 'victim');
    await login(h, scammer, deviceFor('fw-fire'));
    await h.admin.setFraudWatch(adminActor(h.adminUserIds[0]), await onixOf(h, scammer), {
      comment: 'Обманул на 1000 рублей', victimOnixId: await onixOf(h, victim),
      claimCents: SCAM_CENTS.toString(),
    });

    // The seller earns less than the claim, so a partial repayment must still happen.
    const sale = await pendingSale(h, 'fire', scammer);
    await h.escrow.complete(actor(sale.buyer), sale.orderId, `fw-complete-${randomUUID()}`);

    const scammerRow = await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer },
      select: {
        deletedAt: true, bannedAt: true, banReason: true, banStrikeCount: true,
        fraudWatchAt: true, withdrawBlockedAt: true, suspiciousFundsHoldAt: true, balanceCents: true,
      },
    });
    assert.equal(scammerRow.balanceCents, 0n, 'proceeds went to the victim, not the seller');
    assert.ok(scammerRow.deletedAt, 'the account is banned automatically');
    assert.ok(scammerRow.bannedAt);
    assert.equal(scammerRow.banReason, 'FRAUD');
    assert.equal(scammerRow.banStrikeCount, 1, 'the auto-ban counts as a strike');
    assert.equal(scammerRow.fraudWatchAt, null, 'the marker is consumed, never left armed');
    assert.ok(scammerRow.withdrawBlockedAt, 'withdrawals are blocked');
    assert.ok(scammerRow.suspiciousFundsHoldAt, 'remaining funds are held');

    const victimRow = await h.prisma.user.findUniqueOrThrow({
      where: { id: victim }, select: { balanceCents: true },
    });
    assert.equal(victimRow.balanceCents, sale.payoutCents, 'victim repaid from the proceeds');

    // Every money move has a ledger pair, otherwise reconciliation would flag drift.
    const ledger = await h.prisma.ledgerEntry.findMany({
      where: { orderId: sale.orderId, type: { in: ['CLAWBACK', 'REFUND'] } },
      select: { userId: true, type: true, amountCents: true, fundKind: true },
    });
    assert.equal(ledger.length, 2, 'one debit from the seller, one credit to the victim');
    const debit = ledger.find((l) => l.userId === scammer);
    const credit = ledger.find((l) => l.userId === victim);
    assert.ok(debit && debit.type === 'CLAWBACK' && debit.amountCents === -sale.payoutCents);
    assert.ok(credit && credit.type === 'REFUND' && credit.amountCents === sale.payoutCents);
    assert.equal(debit!.fundKind, 'SALE_PROCEEDS', 'the repayment is tagged as sale proceeds');
    assert.equal(credit!.fundKind, 'USER_OWNED', 'the victim receives own, spendable funds');

    const live = await h.prisma.session.count({ where: { userId: scammer, revokedAt: null } });
    assert.equal(live, 0, 'all sessions revoked by the auto-ban');

    // The arming step also writes FRAUD_WATCH_TRIGGERED (kind=FRAUD_WATCH_ARMED), so
    // select the interception explicitly rather than taking whichever row is first.
    const event = await h.prisma.securityEvent.findFirst({
      where: {
        userId: scammer,
        type: 'FRAUD_WATCH_TRIGGERED',
        payload: { path: ['kind'], equals: 'SALE_PAYOUT_INTERCEPTED' },
      },
      select: { severity: true, payload: true },
    });
    assert.ok(event, 'support sees the trigger');
    const payload = event!.payload as { kind?: string; repaidCents?: string; victimUserId?: string };
    assert.equal(payload.kind, 'SALE_PAYOUT_INTERCEPTED');
    assert.equal(payload.repaidCents, sale.payoutCents.toString());
    assert.equal(payload.victimUserId, victim.toString());
  } finally {
    await close(h);
  }
});

dbTest('a DEPOSIT must not fire the marker: own money is not fraud proceeds', async () => {
  const h = await harness();
  try {
    const scammer = await makeUser(h, 'depositor');
    const victim = await makeUser(h, 'victim');
    await h.admin.setFraudWatch(adminActor(h.adminUserIds[0]), await onixOf(h, scammer), {
      comment: 'Обманул на 1000 рублей', victimOnixId: await onixOf(h, victim),
      claimCents: SCAM_CENTS.toString(),
    });

    const balance = new BalanceService();
    await h.prisma.$transaction((tx) => balance.credit(tx, scammer, SCAM_CENTS, 'DEPOSIT', {
      idempotencyKey: `fw-deposit-${randomUUID()}`, description: 'Пополнение',
      source: 'USER', fundKind: 'USER_OWNED',
    }));
    // consumeOnPayout is only called from the payout path; with a zero payout there is
    // nothing to intercept and the marker must survive.
    const consumed = await h.prisma.$transaction((tx) => h.fraudWatch.consumeOnPayout(tx, scammer, 1n, 0n));
    assert.equal(consumed.armed, false, 'a zero payout cannot consume the marker');

    const row = await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer },
      select: { deletedAt: true, fraudWatchAt: true, balanceCents: true, withdrawBlockedAt: true },
    });
    assert.equal(row.deletedAt, null, 'a deposit must not ban the account');
    assert.ok(row.fraudWatchAt, 'the marker is still armed for the next SALE');
    assert.equal(row.balanceCents, SCAM_CENTS);
    assert.equal(row.withdrawBlockedAt, null, 'own funds are not seized by the marker');

    const victimRow = await h.prisma.user.findUniqueOrThrow({
      where: { id: victim }, select: { balanceCents: true },
    });
    assert.equal(victimRow.balanceCents, 0n, 'the victim is never paid from a deposit');
  } finally {
    await close(h);
  }
});

dbTest('the trigger is not repeatable: a replayed completion pays nobody twice', async () => {
  const h = await harness();
  try {
    const scammer = await makeUser(h, 'repeat');
    const victim = await makeUser(h, 'victim');
    await login(h, scammer, deviceFor('fw-repeat'));
    await h.admin.setFraudWatch(adminActor(h.adminUserIds[0]), await onixOf(h, scammer), {
      comment: 'Обманул на 1000 рублей', victimOnixId: await onixOf(h, victim),
      claimCents: SCAM_CENTS.toString(),
    });

    const sale = await pendingSale(h, 'round1', scammer);
    const key = `fw-c1-${randomUUID()}`;
    await h.escrow.complete(actor(sale.buyer), sale.orderId, key);
    const afterFirst = (await h.prisma.user.findUniqueOrThrow({
      where: { id: victim }, select: { balanceCents: true },
    })).balanceCents;
    assert.equal(afterFirst, sale.payoutCents);

    // Same idempotency key replayed: must not repay a second time.
    await h.escrow.complete(actor(sale.buyer), sale.orderId, key).catch(() => undefined);
    const afterReplay = (await h.prisma.user.findUniqueOrThrow({
      where: { id: victim }, select: { balanceCents: true },
    })).balanceCents;
    assert.equal(afterReplay, afterFirst, 'a replayed completion must not pay twice');

    const intercepted = await h.prisma.securityEvent.count({
      where: {
        userId: scammer,
        type: 'FRAUD_WATCH_TRIGGERED',
        payload: { path: ['kind'], equals: 'SALE_PAYOUT_INTERCEPTED' },
      },
    });
    assert.equal(intercepted, 1, 'exactly one interception is recorded');
  } finally {
    await close(h);
  }
});
// ---------------------------------------------------------------------------
// 2. Replacement accounts: must be refused even after an IP change.
// ---------------------------------------------------------------------------
dbTest('the replacement account is refused at signup, and an IP change does not help', async () => {
  const h = await harness();
  try {
    const scammer = await makeUser(h, 'evader');
    const device = deviceFor('fw-evader', '203.0.113.7');
    await login(h, scammer, device);

    // Arm markers exactly the way the auto-ban does, and ban the row itself.
    await h.risk.recordBanMarkers(h.prisma, scammer);
    await h.prisma.user.update({
      where: { id: scammer },
      data: { deletedAt: new Date(), bannedAt: new Date(), banReason: 'FRAUD' },
    });

    // The device fingerprint must not depend on the IP address at all: it is derived
    // from stable browser/PWA signals only. If this ever changes, IP rotation would
    // silently defeat the whole registration filter.
    const original = h.deviceTrust.resolveDeviceId(device);
    for (const ip of ['198.18.240.13', '192.0.2.200', '100.64.0.7']) {
      assert.equal(
        h.deviceTrust.resolveDeviceId(deviceFor('fw-evader', ip)),
        original,
        `the fingerprint must not change when the IP changes (${ip})`,
      );
    }

    const attemptSignup = async (ip: string) => {
      const telegramId = BigInt(`9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`);
      const outcome = await h.prisma.$transaction((tx) => h.identity.upsertTelegramUser(tx, {
        telegramId, username: 'fresh', firstName: 'Fresh',
      }, deviceFor('fw-evader', ip))).then(
        () => 'registered' as const,
        (error: unknown) => (error as { code?: string }).code ?? 'error',
      );
      assert.equal(outcome, 'AUTH_ACCOUNT_LOCKED', `signup on IP ${ip} must be refused`);
      const created = await h.prisma.user.count({ where: { telegramId } });
      assert.equal(created, 0, `a refused signup must not leave a user row (IP ${ip})`);
    };

    await attemptSignup('203.0.113.7');
    await attemptSignup('198.18.240.13');
    await attemptSignup('192.0.2.200');
    await attemptSignup('100.64.0.7');

    // Evidence survives every attempt, which is what support reads afterwards.
    const blocked = await h.prisma.securityEvent.count({ where: { type: 'REGISTRATION_BLOCKED' } });
    assert.ok(blocked >= 4, `every blocked attempt must be recorded, got ${blocked}`);

    const sample = await h.prisma.securityEvent.findFirst({
      where: { type: 'REGISTRATION_BLOCKED' }, orderBy: { createdAt: 'desc' }, select: { payload: true },
    });
    const payload = sample!.payload as { factors?: string[]; hits?: Array<{ sourceUserId: string }> };
    assert.ok((payload.factors ?? []).length >= 2, 'blocking requires two distinct factors');
    assert.ok(
      (payload.hits ?? []).some((hit) => hit.sourceUserId === scammer.toString()),
      'the event names the punished account it is attached to',
    );
  } finally {
    await close(h);
  }
});

dbTest('changing IP alone cannot rescue a punished account: TELEGRAM_ID and PHONE_HASH do not rotate', async () => {
  const h = await harness();
  try {
    const scammer = await makeUser(h, 'phone-evader');
    // Bind a phone the way the bot capture does, then arm markers from it.
    const phoneHash = createHash('sha256').update('+79001234567').digest('hex');
    await h.prisma.user.update({ where: { id: scammer }, data: { phoneHash } });
    await h.prisma.abuseMarker.upsert({
      where: { kind_valueHash: { kind: 'PHONE_HASH', valueHash: phoneHash } },
      create: { kind: 'PHONE_HASH', valueHash: phoneHash, sourceUserId: scammer },
      update: { sourceUserId: scammer, revokedAt: null },
    });
    await h.risk.recordBanMarkers(h.prisma, scammer);
    await h.prisma.user.update({
      where: { id: scammer },
      data: { deletedAt: new Date(), bannedAt: new Date(), banReason: 'FRAUD' },
    });

    // Reusing the SAME telegram id must never mint a second account, on any IP.
    const sameTelegram = (await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer }, select: { telegramId: true },
    })).telegramId!;
    const outcome = await h.prisma.$transaction((tx) => h.identity.upsertTelegramUser(tx, {
      telegramId: sameTelegram, username: 'relogin', firstName: 'Re',
    }, deviceFor('totally-new-device', '192.0.2.99'))).then(
      () => 'registered' as const,
      (error: unknown) => (error as { code?: string }).code ?? 'error',
    );
    assert.equal(outcome, 'AUTH_ACCOUNT_LOCKED', 'a punished Telegram identity stays locked');
    const twins = await h.prisma.user.count({ where: { telegramId: sameTelegram } });
    assert.equal(twins, 1, 'no duplicate account was minted for the same Telegram identity');

    // A genuinely new account reusing the punished PHONE is caught at capture time,
    // which is the real enforcement point for PHONE_HASH.
    const newcomer = await makeUser(h, 'newcomer');
    const newcomerTg = (await h.prisma.user.findUniqueOrThrow({
      where: { id: newcomer }, select: { telegramId: true },
    })).telegramId!;
    // The capture service compares keyed hashes; assert its conflict branch would fire:
    // the unique phoneHash still points at the punished account, so it still collides.
    const collision = await h.prisma.user.findFirst({
      where: { phoneHash, id: { not: newcomer } }, select: { id: true, deletedAt: true },
    });
    assert.ok(collision, 'the punished phone is still bound and therefore still collides');
    assert.ok(collision!.deletedAt, 'and it belongs to a punished account');
    assert.ok(newcomerTg > 0n);
  } finally {
    await close(h);
  }
});
// ---------------------------------------------------------------------------
// 3. Strike escalation.
// ---------------------------------------------------------------------------
dbTest('ban policy escalation: first ban 7 days, second 28, third permanent', () => {
  assert.equal(banDurationDaysForStrike('MISCONDUCT', 0), 7, 'first ban: base window');
  assert.equal(banDurationDaysForStrike('MISCONDUCT', 1), 28, 'second ban: 4x');
  assert.equal(banDurationDaysForStrike('MISCONDUCT', 2), null, 'third ban: permanent');
  assert.equal(banDurationDaysForStrike('MISCONDUCT', 5), null, 'stays permanent');
  // Already-permanent reasons never become finite.
  assert.equal(banDurationDaysForStrike('FRAUD', 0), null);
  assert.equal(banDurationDaysForStrike('FRAUD', 1), null);
  // A bad strike count must not silently shorten a ban.
  assert.equal(banDurationDaysForStrike('MISCONDUCT', -1), 7);
  assert.equal(banDurationDaysForStrike('THIRD_PARTY_ADS', 1), 120, '30 days x 4');
});

dbTest('strike counter actually escalates across repeated admin bans', async () => {
  const h = await harness();
  try {
    const seller = await makeUser(h, 'repeat-offender');
    const onix = await onixOf(h, seller);
    const adminId = h.adminUserIds[0];

    await h.admin.banUser(adminActor(adminId), onix, { reason: 'MISCONDUCT', comment: 'Первый' });
    const first = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller }, select: { banStrikeCount: true, bannedUntil: true },
    });
    assert.equal(first.banStrikeCount, 1);
    assert.ok(first.bannedUntil!.getTime() < Date.now() + 8 * 86_400_000, 'first ban stays ~7 days');

    await h.admin.unbanUser(adminActor(adminId), onix, 'Проверка');
    await h.admin.banUser(adminActor(adminId), onix, { reason: 'MISCONDUCT', comment: 'Второй' });
    const second = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller }, select: { banStrikeCount: true, bannedUntil: true },
    });
    assert.equal(second.banStrikeCount, 2);
    const window2 = second.bannedUntil!.getTime() - Date.now();
    assert.ok(window2 > 27 * 86_400_000, `second ban must be ~28 days, got ${window2 / 86_400_000}d`);

    await h.admin.unbanUser(adminActor(adminId), onix, 'Проверка');
    await h.admin.banUser(adminActor(adminId), onix, { reason: 'MISCONDUCT', comment: 'Третий' });
    const third = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller }, select: { banStrikeCount: true, bannedUntil: true },
    });
    assert.equal(third.banStrikeCount, 3);
    assert.equal(third.bannedUntil, null, 'the third strike is permanent');

    // Unbanning must NOT reset the strike history, or escalation is meaningless.
    await h.admin.unbanUser(adminActor(adminId), onix, 'Разбан');
    const afterUnban = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller }, select: { banStrikeCount: true, deletedAt: true },
    });
    assert.equal(afterUnban.deletedAt, null);
    assert.equal(afterUnban.banStrikeCount, 3, 'an unban does not wipe the strike history');

    const logged = await h.prisma.adminActionLog.findMany({
      where: { adminUserId: adminId, action: 'ADMIN_USER_BAN', targetId: seller.toString() },
      select: { metadataJson: true }, orderBy: { id: 'asc' },
    });
    assert.equal(logged.length, 3);
    const strikes = logged.map((row) => (row.metadataJson as { strike?: number }).strike);
    assert.deepEqual(strikes, [1, 2, 3], 'each ban records which strike it was');
    assert.equal((logged[2].metadataJson as { permanent?: boolean }).permanent, true);
  } finally {
    await close(h);
  }
});

dbTest('the auto-ban after a marker counts as a strike and escalates the next one', async () => {
  const h = await harness();
  try {
    const scammer = await makeUser(h, 'auto-strike');
    const victim = await makeUser(h, 'victim');
    await login(h, scammer, deviceFor('fw-autostrike'));
    await h.admin.setFraudWatch(adminActor(h.adminUserIds[0]), await onixOf(h, scammer), {
      comment: 'Обманул на 1000 рублей', victimOnixId: await onixOf(h, victim),
      claimCents: SCAM_CENTS.toString(),
    });

    const sale = await pendingSale(h, 'autostrike', scammer);
    await h.escrow.complete(actor(sale.buyer), sale.orderId, `fw-as-${randomUUID()}`);
    const afterAuto = await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer }, select: { banStrikeCount: true, bannedUntil: true, banReason: true },
    });
    assert.equal(afterAuto.banStrikeCount, 1);
    // FRAUD is already permanent, so a first auto-ban is permanent too.
    assert.equal(afterAuto.bannedUntil, null);
    assert.equal(afterAuto.banReason, 'FRAUD');
  } finally {
    await close(h);
  }
});
// ---------------------------------------------------------------------------
// 4. Clearing the marker (false positive) and validation guards.
// ---------------------------------------------------------------------------
dbTest('clearing the marker revokes its registration markers so a cleared seller can return', async () => {
  const h = await harness();
  try {
    const device = deviceFor('fw-cleared');
    const seller = await makeUser(h, 'cleared');
    await login(h, seller, device);
    const onix = await onixOf(h, seller);
    const adminId = h.adminUserIds[0];

    await h.admin.setFraudWatch(adminActor(adminId), onix, { comment: 'Подозрение' });
    const armedCount = await h.prisma.abuseMarker.count({
      where: { sourceUserId: seller, revokedAt: null },
    });
    assert.ok(armedCount > 0, 'arming the watch also armed registration markers');

    await h.admin.clearFraudWatch(adminActor(adminId), onix, 'Ложное срабатывание');
    const revoked = await h.prisma.abuseMarker.count({
      where: { sourceUserId: seller, revokedAt: null },
    });
    assert.equal(revoked, 0, 'a cleared seller must not stay blocked from registering');

    const row = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller },
      select: {
        fraudWatchAt: true, fraudWatchReason: true,
        fraudWatchVictimUserId: true, fraudWatchClaimCents: true,
      },
    });
    assert.equal(row.fraudWatchAt, null);
    assert.equal(row.fraudWatchReason, null);
    assert.equal(row.fraudWatchVictimUserId, null);
    assert.equal(row.fraudWatchClaimCents, 0n);

    // And the seller can register again on the same device.
    const fresh = await h.prisma.$transaction((tx) => h.identity.upsertTelegramUser(tx, {
      telegramId: BigInt(`9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`),
      username: 'cleared-new', firstName: 'Cleared',
    }, device)).then((u) => u.id, () => null);
    if (fresh) h.userIds.push(fresh);
    assert.ok(fresh, 'after clearing, registration on the same device is allowed again');
  } finally {
    await close(h);
  }
});

dbTest('arming refuses a wiped or self-referential victim, a claim without an amount, and a banned seller', async () => {
  const h = await harness();
  try {
    const seller = await makeUser(h, 'guard-seller');
    const sellerOnix = await onixOf(h, seller);
    const adminId = h.adminUserIds[0];

    // Self-reference: would let a seller "repay" themselves and launder the marker away.
    await assert.rejects(
      () => h.admin.setFraudWatch(adminActor(adminId), sellerOnix, {
        comment: 'Себе', victimOnixId: sellerOnix, claimCents: '1000',
      }),
      /тот же аккаунт|пострадавш/i,
    );

    // A wiped victim cannot be credited, so refuse up front rather than arm a dead marker.
    const wiped = await makeUser(h, 'wiped-victim');
    await h.prisma.user.update({
      where: { id: wiped },
      data: { deletedAt: new Date(), displayName: 'Удалённый аккаунт' },
    });
    const wipedOnix = await onixOf(h, wiped);
    await assert.rejects(
      () => h.admin.setFraudWatch(adminActor(adminId), sellerOnix, {
        comment: 'Стёртый', victimOnixId: wipedOnix, claimCents: '1000',
      }),
      /стёрт/i,
    );

    // Victim declared but no amount: a marker that could not repay is worse than none.
    const victim = await makeUser(h, 'guard-victim');
    const victimOnix = await onixOf(h, victim);
    await assert.rejects(
      () => h.admin.setFraudWatch(adminActor(adminId), sellerOnix, {
        comment: 'Без суммы', victimOnixId: victimOnix,
      }),
      /сумм/i,
    );

    // No comment at all.
    await assert.rejects(
      () => h.admin.setFraudWatch(adminActor(adminId), sellerOnix, { comment: '   ' }),
      /коммент/i,
    );

    // Already banned: the marker would be meaningless.
    await h.admin.banUser(adminActor(adminId), sellerOnix, { reason: 'FRAUD', comment: 'Бан' });
    await assert.rejects(
      () => h.admin.setFraudWatch(adminActor(adminId), sellerOnix, { comment: 'После бана' }),
      /уже заблокирован/i,
    );
  } finally {
    await close(h);
  }
});

dbTest('support completes the sale: the marker still fires on the admin path', async () => {
  const h = await harness();
  try {
    const scammer = await makeUser(h, 'admin-path');
    const victim = await makeUser(h, 'victim');
    const support = await makeUser(h, 'support');
    await login(h, scammer, deviceFor('fw-adminpath'));
    await h.admin.setFraudWatch(adminActor(h.adminUserIds[0]), await onixOf(h, scammer), {
      comment: 'Обманул на 1000 рублей', victimOnixId: await onixOf(h, victim),
      claimCents: SCAM_CENTS.toString(),
    });

    const sale = await pendingSale(h, 'adminpath', scammer);
    await h.escrow.completeByAdmin(supportActor(support), sale.orderId, 'Поддержка подтвердила');

    const scammerRow = await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer },
      select: { deletedAt: true, fraudWatchAt: true, withdrawBlockedAt: true },
    });
    assert.ok(scammerRow.deletedAt, 'the marker fires on the support/admin completion path too');
    assert.equal(scammerRow.fraudWatchAt, null);
    assert.ok(scammerRow.withdrawBlockedAt);

    const victimRow = await h.prisma.user.findUniqueOrThrow({
      where: { id: victim }, select: { balanceCents: true },
    });
    assert.equal(victimRow.balanceCents, sale.payoutCents);
  } finally {
    await close(h);
  }
});

dbTest('partial repayment: a small payout still pays the victim everything available', async () => {
  const h = await harness();
  try {
    const scammer = await makeUser(h, 'partial');
    const victim = await makeUser(h, 'victim');
    await login(h, scammer, deviceFor('fw-partial'));
    await h.admin.setFraudWatch(adminActor(h.adminUserIds[0]), await onixOf(h, scammer), {
      comment: 'Обманул на 1000 рублей', victimOnixId: await onixOf(h, victim),
      claimCents: SCAM_CENTS.toString(),
    });

    const sale = await pendingSale(h, 'partial', scammer);
    assert.ok(sale.payoutCents < SCAM_CENTS, 'the drill must repay less than the claim');
    await h.escrow.complete(actor(sale.buyer), sale.orderId, `fw-partial-${randomUUID()}`);

    const victimRow = await h.prisma.user.findUniqueOrThrow({
      where: { id: victim }, select: { balanceCents: true },
    });
    assert.equal(victimRow.balanceCents, sale.payoutCents, 'the victim gets everything available');

    const scammerRow = await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer }, select: { deletedAt: true, balanceCents: true },
    });
    assert.ok(scammerRow.deletedAt, 'a partial repayment still bans: the fraud was confirmed');
    assert.equal(scammerRow.balanceCents, 0n, 'the seller keeps none of it');

    const event = await h.prisma.securityEvent.findFirst({
      where: {
        userId: scammer,
        type: 'FRAUD_WATCH_TRIGGERED',
        payload: { path: ['kind'], equals: 'SALE_PAYOUT_INTERCEPTED' },
      },
      select: { payload: true },
    });
    assert.ok(event, 'the interception event exists');
    const payload = event!.payload as { repaidCents?: string; claimCents?: string };
    assert.equal(payload.repaidCents, sale.payoutCents.toString());
    assert.equal(payload.claimCents, SCAM_CENTS.toString(),
      'the shortfall is recorded so support knows the victim is still owed');
  } finally {
    await close(h);
  }
});

dbTest('trust score: an armed marker alone costs nothing; only the ban applies the 200 penalty', async () => {
  const h = await harness();
  try {
    const scammer = await makeUser(h, 'trust');
    const victim = await makeUser(h, 'victim');
    await login(h, scammer, deviceFor('fw-trust'));

    const before = await h.trust.recompute(scammer);
    await h.admin.setFraudWatch(adminActor(h.adminUserIds[0]), await onixOf(h, scammer), {
      comment: 'Обманул на 1000 рублей', victimOnixId: await onixOf(h, victim),
      claimCents: SCAM_CENTS.toString(),
    });
    // Arming the marker is NOT a ban: reputation must not be destroyed yet, the seller
    // is still allowed to earn in order to repay.
    const whileArmed = await h.trust.recompute(scammer);
    assert.equal(whileArmed.penalties, before.penalties,
      'an armed marker alone must not add the ban penalty - selling has to stay viable');

    const sale = await pendingSale(h, 'trust', scammer);
    await h.escrow.complete(actor(sale.buyer), sale.orderId, `fw-trust-${randomUUID()}`);
    const after = await h.trust.recompute(scammer);
    assert.ok(after.penalties >= whileArmed.penalties + 200, 'the auto-ban adds the ban penalty');
    assert.ok(after.score <= whileArmed.score, 'trust never survives the ban');
  } finally {
    await close(h);
  }
});

dbTest('a marker with no victim declared just freezes and bans on the first sale', async () => {
  const h = await harness();
  try {
    const scammer = await makeUser(h, 'no-victim');
    await login(h, scammer, deviceFor('fw-novictim'));
    await h.admin.setFraudWatch(adminActor(h.adminUserIds[0]), await onixOf(h, scammer), {
      comment: 'Скам без конкретного пострадавшего',
    });

    const sale = await pendingSale(h, 'novictim', scammer);
    await h.escrow.complete(actor(sale.buyer), sale.orderId, `fw-nv-${randomUUID()}`);

    const row = await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer },
      select: { deletedAt: true, balanceCents: true, withdrawBlockedAt: true },
    });
    assert.ok(row.deletedAt, 'the account is banned on the first sale');
    assert.ok(row.withdrawBlockedAt, 'the proceeds are frozen for manual support action');
    assert.equal(row.balanceCents, sale.payoutCents,
      'with no declared victim the money is NOT confiscated - it stays, frozen, for support');

    const credit = await h.prisma.ledgerEntry.count({
      where: { orderId: sale.orderId, type: 'CLAWBACK' },
    });
    assert.equal(credit, 0, 'no clawback without a declared victim - the platform never invents one');
  } finally {
    await close(h);
  }
});