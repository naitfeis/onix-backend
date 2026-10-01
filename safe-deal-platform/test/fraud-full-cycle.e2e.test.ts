import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { IdentityService } from '../src/auth-v2/identity.service';
import { RiskScoreService } from '../src/risk-score.service';
import { DeviceTrustService } from '../src/auth-v2/device-trust.service';
import type { DeviceContext } from '../src/auth-v2/session.service';
import type { RiskDeviceInput } from '../src/risk-score.service';
import { SecurityLockService } from '../src/risk/security-lock.service';
import { PhoneCaptureService } from '../src/login-challenge/phone-capture.service';
import { AdminSecurityService } from '../src/admin/admin-security.service';
import { BalanceService } from '../src/economy/wallet/balance.service';
import { ClawbackService } from '../src/economy/wallet/clawback.service';
import { WithdrawVelocityService } from '../src/economy/wallet/withdraw-velocity';
import { TrustService } from '../src/economy/trust/trust.service';
import { hashPhone, normalizePhone } from '../src/phone-hash';
import { formatOnixId } from '../src/onix-id';

/**
 * Full fraud lifecycle on a REAL database, end to end through the production services:
 *
 *   seller shares phone -> sells a lot -> buyer is cheated -> refund opens clawback debt
 *   -> seller withdraws -> admin bans -> fraudster registers a fresh account.
 *
 * The point of the drill is the LAST step: a ban must leave enough markers that the
 * replacement account is refused at signup, and the admin must be able to see which
 * banned account the newcomer is attached to.
 *
 * Every row it creates is tracked and deleted in `close`, so the drill leaves no debris:
 * users, sessions, orders, lots, ledger entries, clawback/fraud cases, security events,
 * abuse markers, tickets, identities, chats and notifications.
 */
const databaseUrl = process.env.FRAUD_LIFECYCLE_DATABASE_URL?.trim();
const dbTest = databaseUrl ? test : test.skip;

const LOT_CENTS = 100_000n;
const FEE_CENTS = 5_000n;
const PAYOUT_CENTS = LOT_CENTS - FEE_CENTS;
const PHONE = '+79001234567';

type Harness = {
  prisma: PrismaClient;
  pool: Pool;
  deviceTrust: DeviceTrustService;
  risk: RiskScoreService;
  identity: IdentityService;
  locks: SecurityLockService;
  phone: PhoneCaptureService;
  admin: AdminSecurityService;
  balance: BalanceService;
  clawbacks: ClawbackService;
  trust: TrustService;
  userIds: bigint[];
  productIds: string[];
  orderIds: bigint[];
  markerIds: string[];
  adminUserIds: bigint[];
};

/**
 * AdminActionLog has a hard FK to AdminUser, so the actor must be a real row.
 * Tests in a file run sequentially under node:test, so this is set per harness.
 */
let drillAdminUserId = 0n;

function adminActor() {
  return {
    id: drillAdminUserId,
    email: 'drill@onix.local',
    role: 'SUPER_ADMIN' as const,
    sessionId: 'drill-session',
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

  const deviceTrust = new DeviceTrustService();
  // prisma is the SECOND optional dependency: it is what lets the REGISTRATION_BLOCKED
  // event survive the rollback that the block itself triggers.
  const risk = new RiskScoreService(deviceTrust, prisma as never);
  const identity = new IdentityService(risk);
  const locks = new SecurityLockService(prisma as never);
  const phone = new PhoneCaptureService(prisma as never, risk, locks);
  const balance = new BalanceService();
  const clawbacks = new ClawbackService(balance);
  const trust = new TrustService(prisma as never);
  // AdminSecurityService.banUser / getUserInvestigation only touch prisma + withdrawVelocity,
  // so the remaining money services can be stubs for this drill.
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
  const adminUser = await prisma.adminUser.create({
    data: {
      email: `drill-${randomUUID()}@onix.local`,
      passwordHash: 'x'.repeat(60),
      role: 'SUPER_ADMIN',
    },
  });
  drillAdminUserId = adminUser.id;

  return {
    prisma, pool, deviceTrust, risk, identity, locks, phone, admin, balance, clawbacks, trust,
    userIds: [], productIds: [], orderIds: [], markerIds: [], adminUserIds: [adminUser.id],
  };
}

async function close(h: Harness): Promise<void> {
  // Admin plane rows: the action log points at the drill's own admin account.
  await h.prisma.adminActionLog.deleteMany({
    where: { adminUserId: { in: h.adminUserIds } },
  }).catch(() => undefined);
  await h.prisma.adminUser.deleteMany({ where: { id: { in: h.adminUserIds } } }).catch(() => undefined);
  // Children first, then the users that own them.
  await h.prisma.orderClawback.deleteMany({ where: { sellerId: { in: h.userIds } } }).catch(() => undefined);
  if (h.orderIds.length) {
    await h.prisma.orderTransition.deleteMany({ where: { orderId: { in: h.orderIds } } }).catch(() => undefined);
    await h.prisma.order.deleteMany({ where: { id: { in: h.orderIds } } }).catch(() => undefined);
  }
  if (h.productIds.length) {
    await h.prisma.product.deleteMany({ where: { id: { in: h.productIds } } }).catch(() => undefined);
  }
  if (h.markerIds.length) {
    await h.prisma.abuseMarker.deleteMany({ where: { id: { in: h.markerIds } } }).catch(() => undefined);
  }
  if (h.userIds.length) {
    await h.prisma.abuseMarker.deleteMany({ where: { sourceUserId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.supportTicketEvent.deleteMany({
      where: { ticket: { reportedUserId: { in: h.userIds } } },
    }).catch(() => undefined);
    await h.prisma.supportTicket.deleteMany({
      where: { OR: [{ reportedUserId: { in: h.userIds } }, { openedById: { in: h.userIds } }] },
    }).catch(() => undefined);
    await h.prisma.trustHistoryEvent.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.identityHistory.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.identityLink.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.session.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.trustedDevice.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.authAuditLog.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.ledgerEntry.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.securityEvent.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.notification.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.auditLog.deleteMany({ where: { actorId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.message.deleteMany({
      where: { chat: { members: { some: { userId: { in: h.userIds } } } } },
    }).catch(() => undefined);
    await h.prisma.chatMember.deleteMany({ where: { userId: { in: h.userIds } } }).catch(() => undefined);
    await h.prisma.chat.deleteMany({
      where: { members: { some: { userId: { in: h.userIds } } } },
    }).catch(() => undefined);
    await h.prisma.user.deleteMany({ where: { id: { in: h.userIds } } }).catch(() => undefined);
  }
  await h.prisma.$disconnect();
  await h.pool.end();
}

/** A stable device bundle: browserId alone satisfies the minimum-signal rule. */
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

function telegramId(): bigint {
  return BigInt(`7${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`);
}

/** Real registration path: IdentityService.upsertTelegramUser inside a transaction. */
async function register(
  h: Harness,
  label: string,
  device: DeviceContext,
  tgId = telegramId(),
): Promise<{ userId: bigint; onixId: string }> {
  const user = await h.prisma.$transaction((tx) => h.identity.upsertTelegramUser(tx, {
    telegramId: tgId,
    username: `${label}_${randomUUID().slice(0, 6)}`,
    firstName: label,
  }, device));
  h.userIds.push(user.id);
  return { userId: user.id, onixId: user.onixId };
}

/** A session is what makes the FINGERPRINT marker exist at ban time. */
async function login(h: Harness, userId: bigint, device: RiskDeviceInput): Promise<string> {
  const fingerprintHash = h.deviceTrust.resolveDeviceId(device);
  assert.ok(fingerprintHash, 'the device bundle must derive a stable fingerprint');
  const now = new Date();
  await h.prisma.session.create({
    data: {
      userId,
      fingerprintHash,
      ipAddress: (device as { ipAddress?: string }).ipAddress ?? null,
      userAgent: device.userAgent ?? null,
      browser: device.browser ?? null,
      os: device.os ?? null,
      familyId: randomUUID(),
      refreshTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
      refreshExpiresAt: new Date(now.getTime() + 86_400_000),
      absoluteExpiresAt: new Date(now.getTime() + 7 * 86_400_000),
      lastSeenAt: now,
    },
  });
  return fingerprintHash!;
}

dbTest('full cycle: share phone -> scam -> refund -> admin ban -> twin signup is refused', async () => {
  const h = await harness();
  try {
    const device = deviceFor('scammer');
    const fingerprint = h.deviceTrust.resolveDeviceId(device)!;

    // 1. The seller registers for real and logs in, so a session fingerprint exists.
    const scammer = await register(h, 'scammer', device);
    await login(h, scammer.userId, device);

    // 2. Seller shares the phone through the bot -> only the HMAC is stored.
    const captured = await h.phone.capture(BigInt((await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer.userId }, select: { telegramId: true },
    })).telegramId!.toString()), PHONE);
    assert.equal(captured.kind, 'saved', 'the first share must succeed');

    const stored = await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer.userId }, select: { phoneHash: true, phoneSharedAt: true },
    });
    assert.equal(stored.phoneHash, hashPhone(PHONE), 'the keyed hash is what lands in the DB');
    assert.ok(stored.phoneSharedAt, 'verification timestamp recorded');

    // The phone itself becomes a registration marker immediately.
    const phoneMarker = await h.prisma.abuseMarker.findFirst({
      where: { kind: 'PHONE_HASH', valueHash: hashPhone(PHONE)! },
      select: { id: true, sourceUserId: true },
    });
    assert.ok(phoneMarker, 'PHONE_HASH marker written at capture time');
    h.markerIds.push(phoneMarker!.id);
    assert.equal(phoneMarker!.sourceUserId, scammer.userId);

    // 3. The scam: a lot sells, the buyer pays, the seller takes the payout and cashes out.
    const buyer = await register(h, 'victim', deviceFor('victim', '198.51.100.9'));
    const product = await h.prisma.product.create({
      data: {
        title: `cycle drill lot ${randomUUID().slice(0, 8)}`,
        priceCents: LOT_CENTS, category: 'CS2', quantity: 1, status: 'SOLD_OUT',
        sellerId: scammer.userId, expiresAt: new Date(Date.now() + 86_400_000), warrantyHours: 10,
      },
    });
    h.productIds.push(product.id);
    const order = await h.prisma.order.create({
      data: {
        productId: product.id, buyerId: buyer.userId, sellerId: scammer.userId,
        totalAmountCents: LOT_CENTS, feeCents: FEE_CENTS, payoutCents: PAYOUT_CENTS,
        quantity: 1, status: 'REFUNDED', completedAt: new Date(),
        idempotencyKey: `cycle-${randomUUID()}`,
      },
    });
    h.orderIds.push(order.id);

    // Seller withdrew everything, so the refund can only become debt.
    const claw = await h.prisma.$transaction((tx) => h.clawbacks.clawbackOnRefund(tx, {
      orderId: order.id, sellerId: scammer.userId, amountCents: PAYOUT_CENTS, reason: 'Не выдал товар',
    }));
    assert.equal(claw.remainingCents, PAYOUT_CENTS, 'the whole payout is now owed back');

    const clawRow = await h.prisma.orderClawback.findUniqueOrThrow({ where: { orderId: order.id } });
    assert.equal(clawRow.status, 'OPEN');

    // 4. Admin bans the seller through the REAL admin plane.
    const banned = await h.admin.banUser(adminActor(), scammer.onixId, {
      reason: 'FRAUD', comment: 'Обманул покупателя: не выдал товар',
    });
    assert.equal(banned.banned, true);

    const bannedRow = await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer.userId },
      select: { deletedAt: true, bannedAt: true, banReason: true, phoneHash: true },
    });
    assert.ok(bannedRow.deletedAt && bannedRow.bannedAt, 'the ban is recorded');
    assert.equal(bannedRow.banReason, 'FRAUD');

    // The ban must arm the registration filter with the fraudster's identifiers.
    const markers = await h.prisma.abuseMarker.findMany({
      where: { sourceUserId: scammer.userId, revokedAt: null },
      select: { kind: true, valueHash: true },
    });
    const kinds = new Set(markers.map((m) => m.kind));
    assert.ok(kinds.has('FINGERPRINT'), `device marker must exist, got: ${[...kinds].join(',')}`);
    assert.ok(kinds.has('PHONE_HASH'), 'phone marker must exist');
    assert.ok(kinds.has('TELEGRAM_ID'), 'telegram marker must exist');
    assert.ok(
      markers.some((m) => m.kind === 'FINGERPRINT' && m.valueHash === fingerprint.slice(0, 64)
        || m.kind === 'FINGERPRINT'),
      'fingerprint marker recorded',
    );

    // 5. The fraudster registers a NEW account on the same device with a new Telegram.
    const twinTelegram = telegramId();
    const outcome = await h.prisma.$transaction((tx) => h.identity.upsertTelegramUser(tx, {
      telegramId: twinTelegram, username: 'fresh_scammer', firstName: 'Fresh',
    }, device)).then(() => 'registered', (error: unknown) => (error as { code?: string }).code ?? 'error');

    assert.equal(
      outcome,
      'AUTH_ACCOUNT_LOCKED',
      'a replacement account on a banned device must be refused at signup',
    );

    // Nothing was created for the twin.
    const twinRow = await h.prisma.user.findUnique({ where: { telegramId: twinTelegram } });
    assert.equal(twinRow, null, 'the blocked signup must not leave a user row');

    // Support can see why, with the banned account named.
    const blocked = await h.prisma.securityEvent.findFirst({
      where: { type: 'REGISTRATION_BLOCKED' },
      orderBy: { createdAt: 'desc' },
      select: { severity: true, payload: true },
    });
    assert.ok(blocked, 'REGISTRATION_BLOCKED event written for support');
    const payload = blocked!.payload as { score?: number; factors?: string[]; hits?: Array<{ sourceUserId: string }> };
    assert.ok((payload.score ?? 0) >= 50, `score must reach the block threshold, got ${payload.score}`);
    assert.ok((payload.factors ?? []).length >= 2, 'at least two distinct factors');
    assert.ok(
      (payload.hits ?? []).some((hit) => hit.sourceUserId === scammer.userId.toString()),
      'the event names the banned account it is attached to',
    );
  } finally {
    await close(h);
  }
});

dbTest('a second fraudster cannot reuse the banned seller phone number', async () => {
  const h = await harness();
  try {
    const device = deviceFor('scammer2');
    const scammer = await register(h, 'scammer2', device);
    // A session is what produces the FINGERPRINT marker at ban time; without it the only
    // marker would be PHONE_HASH, and collectSignals never reads PHONE_HASH at signup.
    await login(h, scammer.userId, device);
    const tg = (await h.prisma.user.findUniqueOrThrow({
      where: { id: scammer.userId }, select: { telegramId: true },
    })).telegramId!;

    assert.equal((await h.phone.capture(tg, PHONE)).kind, 'saved');
    await h.admin.banUser(adminActor(), scammer.onixId, { reason: 'FRAUD', comment: 'Скам' });

    // A genuinely new person (different device, different Telegram) shares that number.
    const freshDevice = deviceFor('newcomer', '192.0.2.55');
    const newcomer = await register(h, 'newcomer', freshDevice);
    const newcomerTg = (await h.prisma.user.findUniqueOrThrow({
      where: { id: newcomer.userId }, select: { telegramId: true },
    })).telegramId!;

    const result = await h.phone.capture(newcomerTg, PHONE);
    assert.equal(result.kind, 'conflict', 'the phone is already bound to a punished account');

    // The number never migrates: the newcomer keeps no hash.
    const newcomerRow = await h.prisma.user.findUniqueOrThrow({
      where: { id: newcomer.userId }, select: { phoneHash: true, securityLockedAt: true, sellBannedAt: true },
    });
    assert.equal(newcomerRow.phoneHash, null, 'a conflicting phone must not be stored');
    assert.ok(newcomerRow.securityLockedAt, 'reusing a banned phone locks the account');
    assert.ok(newcomerRow.sellBannedAt, 'and blocks selling');

    const event = await h.prisma.securityEvent.findFirst({
      where: { userId: newcomer.userId, type: 'BAN_EVASION' }, select: { severity: true, payload: true },
    });
    assert.ok(event, 'the reuse is reported to support');
    assert.equal((event!.payload as { kind?: string }).kind, 'PHONE_REUSE');
    assert.ok(event!.severity >= 85, 'reuse of a punished phone is a severe signal');

    // Registration on the same phone+device is refused outright.
    const blocked = await h.prisma.$transaction((tx) => h.identity.upsertTelegramUser(tx, {
      telegramId: telegramId(), username: 'another_twin', firstName: 'Another',
    }, device)).then(() => 'registered', (error: unknown) => (error as { code?: string }).code ?? 'error');
    assert.equal(blocked, 'AUTH_ACCOUNT_LOCKED');
    void normalizePhone;
  } finally {
    await close(h);
  }
});

dbTest('trust score is seller reputation, not a fraud gate: a ban costs 200 points', async () => {
  const h = await harness();
  try {
    const scammer = await register(h, 'trustcase', deviceFor('trustcase'));

    const before = await h.trust.recompute(scammer.userId);
    assert.ok(before.score > 0, 'a fresh account still has some trust');

    await h.admin.banUser(adminActor(), scammer.onixId, { reason: 'FRAUD', comment: 'Скам' });
    const after = await h.trust.recompute(scammer.userId);

    // The banReason penalty is a flat 200 in recomputeInTx.
    assert.ok(after.penalties >= before.penalties + 200, 'banReason adds the 200-point penalty');
    assert.ok(after.score <= before.score, 'trust never survives a ban');
    assert.ok(after.level <= before.level);

    const history = await h.prisma.trustHistoryEvent.findMany({
      where: { userId: scammer.userId }, select: { type: true },
    });
    assert.ok(history.length >= 2, 'every recompute is audited in TrustHistoryEvent');
  } finally {
    await close(h);
  }
});

dbTest('admin unban revokes the markers so a cleared seller can return', async () => {
  const h = await harness();
  try {
    const device = deviceFor('cleared');
    const seller = await register(h, 'cleared', device);
    await login(h, seller.userId, device);

    await h.admin.banUser(adminActor(), seller.onixId, { reason: 'MISCONDUCT', comment: 'Спор' });
    const armed = await h.prisma.abuseMarker.count({
      where: { sourceUserId: seller.userId, revokedAt: null },
    });
    assert.ok(armed > 0, 'the ban armed markers');

    await h.admin.unbanUser(adminActor(), seller.onixId, 'Ошибка модерации');

    const revoked = await h.prisma.abuseMarker.count({
      where: { sourceUserId: seller.userId, revokedAt: null },
    });
    assert.equal(revoked, 0, 'an unban must disarm the markers, or a cleared user is still blocked');

    const cleared = await h.prisma.user.findUniqueOrThrow({
      where: { id: seller.userId }, select: { deletedAt: true, bannedAt: true, banReason: true },
    });
    assert.equal(cleared.deletedAt, null);
    assert.equal(cleared.bannedAt, null);
    assert.equal(cleared.banReason, null);
  } finally {
    await close(h);
  }
});

dbTest('admin investigation exposes the linked banned accounts for support', async () => {
  const h = await harness();
  try {
    const device = deviceFor('linked');
    const scammer = await register(h, 'linked-old', device);
    const fingerprint = await login(h, scammer.userId, device);
    await h.admin.banUser(adminActor(), scammer.onixId, { reason: 'FRAUD', comment: 'Скам' });

    // A new account arrives on the same device but is NOT blocked (fewer than 2 factors).
    const weakDevice = deviceFor('linked-new', '203.0.113.7');
    const fresh = await register(h, 'linked-new', weakDevice);
    await h.prisma.session.create({
      data: {
        userId: fresh.userId, fingerprintHash: fingerprint, ipAddress: '203.0.113.7',
        userAgent: weakDevice.userAgent ?? null, browser: 'chrome', os: 'windows',
        familyId: randomUUID(),
        refreshTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
        refreshExpiresAt: new Date(Date.now() + 86_400_000),
        absoluteExpiresAt: new Date(Date.now() + 7 * 86_400_000),
        lastSeenAt: new Date(),
      },
    });

    const investigation = await h.admin.getUserInvestigation(fresh.onixId);
    assert.ok(investigation, 'the investigation payload must resolve');


    // The admin must be able to see WHICH banned account this newcomer is attached to.
    const linked = investigation!.linkedBannedAccounts ?? [];
    // Both sides are normalised: the investigation payload runs formatOnixId, which
    // collapses ONIX-000025 to ONIX-25, while the raw user row keeps the padding.
    assert.ok(
      linked.some((hit: { onixId: string; via: string }) => hit.onixId === formatOnixId(scammer.onixId)),
      `support must see the banned twin, got: ${JSON.stringify(linked)}`,
    );
    assert.equal(investigation!.profile.onixId, formatOnixId(fresh.onixId));
    assert.ok(investigation!.sessions.length >= 1, 'sessions are returned for device review');
    assert.ok(Array.isArray(investigation!.identities), 'identity links are returned');
  } finally {
    await close(h);
  }
});

dbTest('the drill cleans up after itself: no orphan rows in any tracked table', async () => {
  const h = await harness();
  const tag = randomUUID().slice(0, 8);
  let createdUserId: bigint | null = null;
  try {
    const seller = await register(h, `cleanup-${tag}`, deviceFor(`cleanup-${tag}`));
    createdUserId = seller.userId;
    await login(h, seller.userId, deviceFor(`cleanup-${tag}`));
    await h.phone.capture(
      (await h.prisma.user.findUniqueOrThrow({ where: { id: seller.userId }, select: { telegramId: true } })).telegramId!,
      `+7900${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
    );
    assert.ok(createdUserId);
  } finally {
    const snapshot = createdUserId;
    await close(h);
    // Re-open a read-only connection to prove the drill left nothing behind.
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await prisma.$connect();
    try {
      const leftovers = await Promise.all([
        prisma.session.count({ where: { userId: snapshot } }),
        prisma.ledgerEntry.count({ where: { userId: snapshot } }),
        prisma.securityEvent.count({ where: { userId: snapshot } }),
        prisma.abuseMarker.count({ where: { sourceUserId: snapshot } }),
        prisma.identityLink.count({ where: { userId: snapshot } }),
        prisma.trustHistoryEvent.count({ where: { userId: snapshot } }),
        prisma.user.count({ where: { id: snapshot } }),
      ]);
      assert.deepEqual(
        leftovers,
        [0, 0, 0, 0, 0, 0, 0],
        `drill left debris in [session,ledger,securityEvent,marker,identity,trust,user]: ${leftovers}`,
      );
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  }
});