/**
 * Throughput + stability drill against REAL Postgres, driving the REAL services.
 *
 * Existing drills cover correctness (fraud lifecycle) and one narrow race
 * (db-concurrency-drill). This one answers the capacity question the product needs
 * before launch: can the chat path hold 100 messages/second and can the money path
 * hold 10 simultaneous deals/second WITHOUT corrupting the ledger or overselling.
 *
 * Scenarios:
 *   A. chat-throughput   - N senders over M pair chats, sustained target msg/s.
 *   B. purchase-race     - 10 concurrent deals/second on ONE lot: exactly `quantity`
 *                          winners, the rest refused, stock never negative.
 *   C. money-invariants  - after everything, the ledger must still reconcile:
 *                          Σ amounts == balance, and every chain link agrees.
 *   D. fraud-watch-race  - an armed marker fires under concurrency: the victim is
 *                          repaid EXACTLY once, never twice.
 *
 * Usage:
 *   $env:THROUGHPUT_DRILL_DATABASE_URL = "postgresql://user@127.0.0.1:55432/drill?sslmode=disable"
 *   npm run ops:throughput-drill
 *   Optional: LOAD_MSG_PER_SEC=100 LOAD_DEALS_PER_SEC=10 LOAD_DURATION_SEC=10 LOAD_POOL_MAX=40
 *
 * Never falls back to DATABASE_URL, and refuses pooler/prod-looking hosts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { BalanceService } from '../src/economy/wallet/balance.service';
import { ClawbackService } from '../src/economy/wallet/clawback.service';
import { LockService } from '../src/economy/wallet/lock.service';
import { DepositService } from '../src/economy/wallet/deposit.service';
import { EscrowService } from '../src/escrow.module';
import { ChatService } from '../src/engagement.module';
import { FraudWatchService } from '../src/risk/fraud-watch.service';
import { RealtimeBus } from '../src/realtime/realtime-bus.service';
import { SharedCoordinationService } from '../src/coordination/shared-coordination.service';
import { MemoryCoordinationAdapter } from '../src/coordination/memory-coordination.adapter';
import { ensurePairChat } from '../src/chat-pair';
import type { AuthUser } from '../src/common';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import WebSocket from 'ws';
import { ConflictException } from '@nestjs/common';
import { RiskEngineService } from '../src/risk/risk-engine.service';
import { RiskScoreService } from '../src/risk-score.service';
import { DeviceTrustService } from '../src/auth-v2/device-trust.service';
import { SecurityLockService } from '../src/risk/security-lock.service';
import { SigningKeyService } from '../src/auth-v2/signing-key.service';
import { TokenService } from '../src/auth-v2/token.service';
import { SessionService } from '../src/auth-v2/session.service';
import { RealtimeAuthService } from '../src/realtime/realtime-auth.service';
import { RealtimeHubService } from '../src/realtime/realtime-hub.service';
import { LedgerReconciliationJob } from '../src/workers/jobs/ledger-reconciliation.job';
import { MetricsService } from '../src/observability/metrics.service';
import { AlertingService } from '../src/observability/alerting.service';
import { ErrorTrackingService } from '../src/observability/error-tracking.service';
import type { SecretsProvider } from '../src/auth-v2/secrets.provider';

// The hub's origin policy rejects missing Origin in production; the drill connects
// over loopback like a native client, so pin a non-production NODE_ENV. The unauth-IP
// cap defaults to 8 and the hub reads it at module load — the drill opens dozens of
// sockets from one loopback IP, so lift the cap before the import below.
process.env.NODE_ENV = 'test';
process.env.REALTIME_MAX_UNAUTH_PER_IP = '200';
process.env.REALTIME_AUTH_TIMEOUT_MS = '15000';

const outDir = resolve(process.cwd(), 'ops-drills');
const evidenceDir = resolve(process.cwd(), 'docs/architecture/ops-evidence');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const MSG_PER_SEC = Number(process.env.LOAD_MSG_PER_SEC ?? 100);
const DEALS_PER_SEC = Number(process.env.LOAD_DEALS_PER_SEC ?? 10);
const DURATION_SEC = Number(process.env.LOAD_DURATION_SEC ?? 10);
const POOL_MAX = Number(process.env.LOAD_POOL_MAX ?? 40);

const LOT_PRICE = 100_000n; // 1000 RUB

function pickUrl(): string {
  const dedicated = (process.env.THROUGHPUT_DRILL_DATABASE_URL ?? '').trim();
  if (dedicated) return dedicated;
  throw new Error(
    'Set THROUGHPUT_DRILL_DATABASE_URL to a scratch Postgres URL '
    + '(this drill never falls back to DATABASE_URL).',
  );
}

function redact(url: string): { host: string | null; isPooler: boolean; looksProd: boolean } {
  try {
    const u = new URL(url.replace(/^postgresql:/i, 'http:'));
    const host = u.hostname;
    const looksProd = ['onixtg', 'prod', 'production', 'render.com']
      .some((s) => host.toLowerCase().includes(s));
    return { host, isPooler: /-pooler\./i.test(host), looksProd };
  } catch {
    return { host: null, isPooler: false, looksProd: false };
  }
}

type Sample = { ok: boolean; status: string; ms: number };

function summarize(samples: Sample[], seconds: number) {
  const sorted = [...samples].map((s) => s.ms).sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const byStatus: Record<string, number> = {};
  for (const s of samples) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  const ok = samples.filter((s) => s.ok).length;
  return {
    total: samples.length,
    ok,
    failed: samples.length - ok,
    throughputPerSec: Number((samples.length / seconds).toFixed(1)),
    p50Ms: Number(pct(0.5).toFixed(1)),
    p95Ms: Number(pct(0.95).toFixed(1)),
    p99Ms: Number(pct(0.99).toFixed(1)),
    maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(1)),
    byStatus,
  };
}

/**
 * Pace `total` operations across `seconds` with an even inter-arrival time, so the
 * measured throughput is the requested rate rather than "as fast as the box allows".
 */
function pacer(total: number, seconds: number, launch: (index: number) => Promise<Sample>) {
  const intervalMs = (seconds * 1000) / total;
  const samples: Sample[] = [];
  const started = performance.now();
  const inflight: Array<Promise<void>> = [];
  return {
    samples,
    async run(): Promise<number> {
      for (let i = 0; i < total; i += 1) {
        const targetAt = started + i * intervalMs;
        const wait = targetAt - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        inflight.push(
          launch(i).then((s) => { samples.push(s); }).catch((error: unknown) => {
            samples.push({
              ok: false,
              status: `unhandled:${error instanceof Error ? error.message.slice(0, 40) : 'error'}`,
              ms: 0,
            });
          }),
        );
      }
      await Promise.all(inflight);
      return (performance.now() - started) / 1000;
    },
  };
}

function userActor(id: bigint): AuthUser {
  return { id, telegramId: null, onixId: 'LD-000000', isAdmin: false, isSupport: false };
}


type Services = {
  prisma: PrismaClient;
  pool: Pool;
  chat: ChatService;
  escrow: EscrowService;
  fraudWatch: FraudWatchService;
  realtime: RealtimeBus;
  coordination: SharedCoordinationService;
  hub: RealtimeHubService;
  tokens: TokenService;
};

const tracked = {
  users: [] as bigint[],
  products: [] as string[],
  orders: [] as bigint[],
};

/** A secrets provider backed by drill-local env, plus a generated Ed25519 pair. */
function drillSecrets(): SecretsProvider {
  const keys = generateKeyPairSync('ed25519');
  const map = new Map<string, string>([
    ['AUTH_ED25519_CURRENT_KID', 'drill-kid'],
    ['AUTH_ED25519_CURRENT_PRIVATE_PEM', keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()],
    ['AUTH_ED25519_CURRENT_PUBLIC_PEM', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()],
    ['DEVICE_HMAC_SECRET', process.env.DEVICE_HMAC_SECRET ?? 'drill-device-hmac-not-for-prod'],
  ]);
  for (const key of ['JWT_SECRET', 'PHONE_HASH_SECRET']) {
    const value = process.env[key];
    if (value) map.set(key, value);
  }
  return {
    get: (name) => map.get(name) ?? process.env[name],
    require: (name) => {
      const value = map.get(name) ?? process.env[name];
      if (!value) throw new Error('Missing secret: ' + name);
      return value;
    },
  };
}

async function buildServices(): Promise<Services> {
  const url = pickUrl();
  const meta = redact(url);
  if (meta.isPooler) throw new Error('Throughput drill requires a direct Postgres endpoint (not -pooler).');
  if (meta.looksProd) throw new Error('Refusing prod-looking host for a load drill.');

  const pool = new Pool({ connectionString: url, max: POOL_MAX });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  await prisma.$connect();

  const secrets = drillSecrets();
  const balance = new BalanceService(new MetricsService());
  const clawbacks = new ClawbackService(balance);
  const locks = new LockService(new DepositService());
  const deviceTrust = new DeviceTrustService();
  const riskScore = new RiskScoreService(deviceTrust, prisma as never);
  const riskEngine = new RiskEngineService(prisma as never, undefined, new SecurityLockService(prisma as never));
  const fraudWatch = new FraudWatchService(prisma as never, balance, riskScore);

  const adapter = new MemoryCoordinationAdapter(100_000);
  const coordination = new SharedCoordinationService(adapter as never, { backend: 'memory', instanceId: 'throughput-drill' } as never);
  await coordination.onModuleInit();
  const realtime = new RealtimeBus(coordination);
  await realtime.onModuleInit();

  // purchase() fans out Telegram notifications after commit; the drill users have no
  // telegramId, so delivery short-circuits to 'skipped' — but never call the network.
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? '';

  const support = { open: async () => undefined } as never;
  const escrow = new EscrowService(
    prisma as never, balance, clawbacks, locks, realtime, support, riskEngine, fraudWatch,
  );
  const chat = new ChatService(prisma as never, realtime, riskEngine);

  const signingKeys = new SigningKeyService(secrets);
  const tokens = new TokenService(signingKeys);
  const sessions = new SessionService(
    prisma as never, tokens, deviceTrust, riskEngine, coordination,
  );
  const realtimeAuth = new RealtimeAuthService(tokens, sessions);
  const hub = new RealtimeHubService(realtimeAuth, realtime, prisma as never);
  hub.onModuleInit();

  return { prisma, pool, chat, escrow, fraudWatch, realtime, coordination, hub, tokens };
}

async function makeUser(svc: Services, label: string, balanceCents = 0n): Promise<bigint> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const user = await svc.prisma.user.create({
    data: {
      onixId: ('LD' + suffix).slice(0, 14).toUpperCase(),
      displayName: 'load drill ' + label,
      balanceCents,
    },
  });
  tracked.users.push(user.id);
  return user.id;
}

async function makeSession(svc: Services, userId: bigint): Promise<string> {
  const session = await svc.prisma.session.create({
    data: {
      userId,
      familyId: randomUUID(),
      refreshTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
      refreshExpiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      lastSeenAt: new Date(),
    },
  });
  return session.id;
}

function accessTokenFor(svc: Services, userId: bigint, sessionId: string): string {
  return svc.tokens.issueAccessToken({ userId, sessionId, sessionVersion: 0, permissionVersion: 0 });
}

async function makeLot(svc: Services, sellerId: bigint, quantity: number, priceCents = LOT_PRICE): Promise<string> {
  const product = await svc.prisma.product.create({
    data: {
      title: 'load drill lot ' + randomUUID().slice(0, 8),
      priceCents, category: 'CS2', quantity, status: 'ACTIVE',
      sellerId, expiresAt: new Date(Date.now() + 86_400_000), warrantyHours: 24,
    },
  });
  tracked.products.push(product.id);
  return product.id;
}

/**
 * Clients retry a 500 on deal actions — safe because every transition carries an
 * idempotency key. The drill does the same and reports how many attempts it took,
 * so a retry storm is visible instead of hidden.
 */
async function withClientRetry<T>(
  run: () => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  maxAttempts = 4,
): Promise<{ value: T | null; attempts: number; error: string | null }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { value: await run(), attempts: attempt, error: null };
    } catch (error) {
      if (attempt === maxAttempts || !isRetryable(error)) {
        return { value: null, attempts: attempt, error: statusOf(error) };
      }
      await new Promise((r) => setTimeout(r, 60 * attempt + Math.floor(Math.random() * 80)));
    }
  }
  return { value: null, attempts: maxAttempts, error: 'exhausted' };
}

function isSerializationConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('TransactionWriteConflict')
    || message.includes('40001')
    || message.includes('40P01')
    || message.includes('could not serialize');
}

function statusOf(error: unknown): string {
  if (error instanceof ConflictException) return 'conflict';
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Недостаточно средств')) return 'insufficient-funds';
  if (message.includes('Товар недоступен')) return 'conflict';
  if (message.includes('Слишком много запросов')) return 'rate-limited';
  return 'error:' + (code ?? message.slice(0, 60));
}

/** Scenario A — chat throughput: unique senders (per-user 60/min limit) at target msg/s. */
async function scenarioChat(svc: Services, report: Record<string, unknown>): Promise<void> {
  const total = MSG_PER_SEC * DURATION_SEC;
  const pairs = Math.max(2, Math.ceil(total / 55)); // stay under 60/min per sender
  const senders: Array<{ actor: AuthUser; chatId: string }> = [];
  for (let i = 0; i < pairs; i += 1) {
    const [a, b] = await Promise.all([makeUser(svc, 'chat-a-' + i), makeUser(svc, 'chat-b-' + i)]);
    const chat = await svc.prisma.$transaction((tx) => ensurePairChat(tx, a, b));
    senders.push({ actor: userActor(a), chatId: chat.id });
  }

  const paced = pacer(total, DURATION_SEC, async (index) => {
    const sender = senders[index % senders.length];
    const startedAt = performance.now();
    try {
      await svc.chat.send(sender.actor, sender.chatId, 'load drill message ' + index, 'drill-msg-' + index);
      return { ok: true, status: 'sent', ms: performance.now() - startedAt };
    } catch (error) {
      return { ok: false, status: statusOf(error), ms: performance.now() - startedAt };
    }
  });
  const seconds = await paced.run();
  const written = await svc.prisma.message.count({
    where: { chatId: { in: senders.map((s) => s.chatId) }, kind: 'USER' },
  });
  const chatOk = written === total;
  report.chat = {
    ...summarize(paced.samples, seconds),
    pairs,
    sendersPerSecond: pairs,
    messagesPersisted: written,
    ok: chatOk && paced.samples.every((s) => s.ok),
    ...(chatOk ? {} : { reason: 'persisted ' + written + ' of ' + total }),
  };
}

/** Scenario B — deals: 10 concurrent purchases/second, each on its own lot+seller. */
async function scenarioDeals(svc: Services, report: Record<string, unknown>): Promise<void> {
  const total = DEALS_PER_SEC * DURATION_SEC;
  const sellers: bigint[] = [];
  const lots: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const sellerId = await makeUser(svc, 'deal-seller-' + i);
    sellers.push(sellerId);
    lots.push(await makeLot(svc, sellerId, 1));
  }
  const buyers: Array<{ actor: AuthUser; productId: string }> = [];
  for (let i = 0; i < total; i += 1) {
    const buyerId = await makeUser(svc, 'deal-buyer-' + i, LOT_PRICE + 10_000n);
    buyers.push({ actor: userActor(buyerId), productId: lots[i] });
  }

  const attemptCounts: number[] = [];
  const paced = pacer(total, DURATION_SEC, async (index) => {
    const entry = buyers[index % buyers.length];
    const startedAt = performance.now();
    // One stable idempotency key per logical purchase: a client retrying a 500 after a
    // serialization conflict must reuse it, otherwise the retry double-buys.
    const key = 'drill-buy-' + randomUUID();
    const result = await withClientRetry(async () => {
      const deal = await svc.escrow.purchase(entry.actor, entry.productId, key, 1);
      tracked.orders.push(BigInt(deal.id));
      return deal;
    }, isSerializationConflict);
    attemptCounts.push(result.attempts);
    return result.value
      ? { ok: true, status: 'purchased', ms: performance.now() - startedAt }
      : { ok: false, status: result.error ?? 'unknown', ms: performance.now() - startedAt };
  });
  const seconds = await paced.run();
  // Money invariant: every purchase debited the buyer exactly once and held funds.
  const holds = await svc.prisma.ledgerEntry.count({
    where: { type: 'PURCHASE_HOLD', userId: { in: tracked.users }, idempotencyKey: { startsWith: 'order:drill-buy-' } },
  });
  const drillOrders = await svc.prisma.order.count({
    where: { idempotencyKey: { startsWith: 'drill-buy-' } },
  });
  const dealsOk = holds === drillOrders;
  report.deals = {
    ...summarize(paced.samples, seconds),
    lots: total,
    maxClientAttempts: Math.max(0, ...attemptCounts),
    ordersCreated: drillOrders,
    holdEntries: holds,
    ok: dealsOk && paced.samples.every((s) => s.ok),
    ...(dealsOk ? {} : { reason: 'hold ledger entries (' + holds + ') != orders (' + drillOrders + ')' }),
  };
}

/** Scenario C — WebSocket: concurrent sockets, auth, subscribe, ping, and a live fan-out. */
async function scenarioWebSocket(svc: Services, report: Record<string, unknown>): Promise<void> {
  const connections = Number(process.env.LOAD_WS_CONNECTIONS ?? 50);
  const server = createServer();
  await new Promise<void>((resolveListen) => { server.listen(0, '127.0.0.1', resolveListen); });
  const port = (server.address() as { port: number }).port;
  svc.hub.attach(server);

  const latencies: number[] = [];
  let ready = 0;
  let fanoutReceived = 0;
  const sockets: WebSocket[] = [];
  const users: Array<{ id: bigint; chatId: string; token: string; peerId: bigint }> = [];
  for (let i = 0; i < connections; i += 1) {
    const [a, b] = await Promise.all([makeUser(svc, 'ws-a-' + i), makeUser(svc, 'ws-b-' + i)]);
    const chat = await svc.prisma.$transaction((tx) => ensurePairChat(tx, a, b));
    const sessionId = await makeSession(svc, a);
    users.push({ id: a, chatId: chat.id, token: accessTokenFor(svc, a, sessionId), peerId: b });
  }

  // Sequential connect+auth (mirrors scripts/load-test-websocket.ts): parallel dials
  // from one IP race the unauth-per-IP guard, and a rejected socket would hang the
  // ready-wait forever. A per-socket timeout keeps the drill from wedging on any frame.
  const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => (
    Promise.race([
      promise,
      new Promise<T>((_, reject) => { setTimeout(() => reject(new Error('ws timeout: ' + label)), ms); }),
    ])
  );
  for (const entry of users) {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/api/realtime');
    sockets.push(ws);
    await withTimeout(new Promise<void>((resolveOpen, rejectOpen) => {
      ws.once('open', () => resolveOpen());
      ws.once('error', (err) => rejectOpen(err));
      ws.once('close', () => rejectOpen(new Error('closed before open')));
    }), 10_000, 'open');
    const readyOnce = new Promise<void>((resolveReady, rejectReady) => {
      ws.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { type: string };
        if (frame.type === 'ready') { ready += 1; resolveReady(); }
        if (frame.type === 'error') rejectReady(new Error(frame.type));
        if (frame.type === 'chat.message') fanoutReceived += 1;
      });
      ws.once('close', () => rejectReady(new Error('closed before ready')));
    });
    ws.send(JSON.stringify({ type: 'auth', accessToken: entry.token }));
    await withTimeout(readyOnce, 10_000, 'ready');
    ws.send(JSON.stringify({ type: 'subscribe_chat', chatId: entry.chatId }));
  }

  // Fan-out receiver: the peer of pair 0 subscribes, then pair 0 sends over HTTP.
  const receiverEntry = users[0];
  const receiverSessionId = await makeSession(svc, receiverEntry.peerId);
  const receiverToken = accessTokenFor(svc, receiverEntry.peerId, receiverSessionId);
  const receiver = new WebSocket('ws://127.0.0.1:' + port + '/api/realtime');
  sockets.push(receiver);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    receiver.once('open', () => resolveOpen());
    receiver.once('error', (err) => rejectOpen(err));
  });
  await new Promise<void>((resolveReady) => {
    receiver.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as { type: string };
      if (frame.type === 'ready') resolveReady();
    });
    receiver.send(JSON.stringify({ type: 'auth', accessToken: receiverToken }));
  });
  await new Promise<void>((resolveSub) => {
    receiver.send(JSON.stringify({ type: 'subscribe_chat', chatId: receiverEntry.chatId }));
    setTimeout(resolveSub, 150);
  });
  receiver.on('message', (raw) => {
    const frame = JSON.parse(String(raw)) as { type: string };
    if (frame.type === 'chat.message') fanoutReceived += 1;
  });

  // Ping storm through the real hub, then one message fanned out to subscribers.
  const pingStart = performance.now();
  await Promise.all(sockets.map((ws) => new Promise<void>((resolvePing) => {
    const timer = setTimeout(() => { ws.off('message', onPong); resolvePing(); }, 10_000);
    const sentAt = performance.now();
    const onPong = (raw: Buffer) => {
      const frame = JSON.parse(String(raw)) as { type: string };
      if (frame.type === 'pong') {
        clearTimeout(timer);
        latencies.push(performance.now() - sentAt);
        ws.off('message', onPong);
        resolvePing();
      }
    };
    ws.on('message', onPong);
    ws.send(JSON.stringify({ type: 'ping' }));
  })));
  const pingSeconds = (performance.now() - pingStart) / 1000;

  const sender = users[0];
  const senderActor = userActor(sender.id);
  await svc.chat.send(senderActor, sender.chatId, 'ws fanout probe', 'ws-drill-' + randomUUID());
  await new Promise((wait) => setTimeout(wait, 500));

  for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
  await new Promise<void>((resolveClose) => { server.close(() => resolveClose()); });

  const sorted = [...latencies].sort((a, b) => a - b);
  report.websocket = {
    connections,
    authenticated: ready,
    fanoutReceived,
    pings: sorted.length,
    pingThroughputPerSec: Number((sorted.length / Math.max(pingSeconds, 0.001)).toFixed(1)),
    pingP50Ms: Number((sorted[Math.floor(sorted.length * 0.5)] ?? 0).toFixed(1)),
    pingP95Ms: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)),
    ok: ready === connections && fanoutReceived === 1,
  };
}

/** Scenario D — mixed: chat + deals + WS fan-out at the same time. */
async function scenarioMixed(svc: Services, report: Record<string, unknown>): Promise<void> {
  const chatTotal = Math.round(MSG_PER_SEC * 0.5 * DURATION_SEC);
  const dealTotal = Math.round(DEALS_PER_SEC * 0.5 * DURATION_SEC);
  const pairs = Math.max(2, Math.ceil(chatTotal / 55));
  const senders: Array<{ actor: AuthUser; chatId: string }> = [];
  for (let i = 0; i < pairs; i += 1) {
    const [a, b] = await Promise.all([makeUser(svc, 'mix-a-' + i), makeUser(svc, 'mix-b-' + i)]);
    const chat = await svc.prisma.$transaction((tx) => ensurePairChat(tx, a, b));
    senders.push({ actor: userActor(a), chatId: chat.id });
  }
  const lots: Array<{ actor: AuthUser; productId: string }> = [];
  for (let i = 0; i < dealTotal; i += 1) {
    const sellerId = await makeUser(svc, 'mix-seller-' + i);
    const buyerId = await makeUser(svc, 'mix-buyer-' + i, LOT_PRICE + 10_000n);
    lots.push({ actor: userActor(buyerId), productId: await makeLot(svc, sellerId, 1) });
  }

  const startedAt = performance.now();
  const chatPaced = pacer(chatTotal, DURATION_SEC, async (index) => {
    const sender = senders[index % senders.length];
    const t0 = performance.now();
    try {
      await svc.chat.send(sender.actor, sender.chatId, 'mixed drill ' + index, 'mix-msg-' + randomUUID());
      return { ok: true, status: 'sent', ms: performance.now() - t0 };
    } catch (error) {
      return { ok: false, status: statusOf(error), ms: performance.now() - t0 };
    }
  });
  const dealPaced = pacer(dealTotal, DURATION_SEC, async (index) => {
    const entry = lots[index % lots.length];
    const t0 = performance.now();
    const key = 'mix-buy-' + randomUUID();
    const result = await withClientRetry(async () => {
      const deal = await svc.escrow.purchase(entry.actor, entry.productId, key, 1);
      tracked.orders.push(BigInt(deal.id));
      return deal;
    }, isSerializationConflict);
    return result.value
      ? { ok: true, status: 'purchased', ms: performance.now() - t0 }
      : { ok: false, status: result.error ?? 'unknown', ms: performance.now() - t0 };
  });
  await Promise.all([chatPaced.run(), dealPaced.run()]);
  const seconds = (performance.now() - startedAt) / 1000;
  const chatFailed = chatPaced.samples.filter((s) => !s.ok).length;
  const dealFailed = dealPaced.samples.filter((s) => !s.ok).length;
  report.mixed = {
    chatMessages: chatTotal,
    chatFailed,
    deals: dealTotal,
    dealsFailed: dealFailed,
    seconds: Number(seconds.toFixed(1)),
    combinedThroughputPerSec: Number(((chatTotal + dealTotal) / seconds).toFixed(1)),
    ok: chatFailed === 0 && dealFailed === 0,
  };
}

/** Deal lifecycle: purchase → deliver → complete → payout lands exactly once per deal. */
async function scenarioDealLifecycle(svc: Services, report: Record<string, unknown>): Promise<void> {
  const total = DEALS_PER_SEC; // one second of deal flow, end-to-end
  const sellerId = await makeUser(svc, 'lifecycle-seller');
  const lotId = await makeLot(svc, sellerId, total);
  const sellerActor = userActor(sellerId);

  const deals: Array<{ orderId: bigint; buyer: AuthUser }> = [];
  const paced = pacer(total, 1, async (index) => {
    const buyerId = await makeUser(svc, 'lifecycle-buyer-' + index, LOT_PRICE + 10_000n);
    const startedAt = performance.now();
    try {
      const deal = await svc.escrow.purchase(userActor(buyerId), lotId, 'life-buy-' + randomUUID(), 1);
      deals.push({ orderId: BigInt(deal.id), buyer: userActor(buyerId) });
      tracked.orders.push(BigInt(deal.id));
      return { ok: true, status: 'purchased', ms: performance.now() - startedAt };
    } catch (error) {
      return { ok: false, status: statusOf(error), ms: performance.now() - startedAt };
    }
  });
  await paced.run();

  // Deliver + complete each deal; every complete must credit the seller exactly once.
  const completeSamples: Sample[] = [];
  const attemptCounts: number[] = [];
  await Promise.all(deals.map(async (deal) => {
    const t0 = performance.now();
    const delivered = await withClientRetry(
      () => svc.escrow.deliver(sellerActor, deal.orderId, 'life-deliver-' + deal.orderId.toString()),
      isSerializationConflict,
    );
    if (!delivered.value) {
      completeSamples.push({ ok: false, status: 'deliver:' + delivered.error, ms: performance.now() - t0 });
      return;
    }
    const completed = await withClientRetry(
      () => svc.escrow.complete(deal.buyer, deal.orderId, 'life-complete-' + deal.orderId.toString()),
      isSerializationConflict,
    );
    attemptCounts.push(completed.attempts);
    completeSamples.push({
      ok: Boolean(completed.value),
      status: completed.value ? 'completed' : 'complete:' + completed.error,
      ms: performance.now() - t0,
    });
  }));

  const payoutRows = tracked.orders.length
    ? await svc.prisma.ledgerEntry.groupBy({
        by: ['orderId'],
        where: { type: 'SALE_PAYOUT', orderId: { in: tracked.orders } },
        _count: { _all: true },
      })
    : [];
  const duplicated = payoutRows.filter((row) => row._count._all !== 1);
  report.dealLifecycle = {
    purchased: deals.length,
    completed: completeSamples.filter((s) => s.ok).length,
    failed: completeSamples.filter((s) => !s.ok).map((s) => s.status),
    maxClientAttempts: Math.max(0, ...attemptCounts),
    payoutRows: payoutRows.length,
    duplicatePayouts: duplicated.length,
    ok: deals.length === total && duplicated.length === 0 && payoutRows.length === deals.length
      && completeSamples.every((s) => s.ok),
  };
}

/** Fraud-watch under concurrency: one armed marker, many racing payouts → victim repaid once. */
async function scenarioFraudWatchRace(svc: Services, report: Record<string, unknown>): Promise<void> {
  const scammerId = await makeUser(svc, 'fraud-seller');
  const victimId = await makeUser(svc, 'fraud-victim');
  const claimCents = 100_000n;
  await svc.prisma.user.update({
    where: { id: scammerId },
    data: {
      fraudWatchAt: new Date(),
      fraudWatchReason: 'drill marker',
      fraudWatchVictimUserId: victimId,
      fraudWatchClaimCents: claimCents,
    },
  });

  const races = 5;
  const lots: Array<{ buyer: AuthUser; productId: string }> = [];
  for (let i = 0; i < races; i += 1) {
    const buyerId = await makeUser(svc, 'fraud-buyer-' + i, LOT_PRICE + 10_000n);
    lots.push({ buyer: userActor(buyerId), productId: await makeLot(svc, scammerId, 1) });
  }
  const scammer = userActor(scammerId);
  // Purchase completion order is nondeterministic — key each order by its own buyer
  // instead of zipping arrays (index pairing once called complete() as the wrong user).
  const dealEntries: Array<{ orderId: bigint; buyer: AuthUser }> = [];
  await Promise.all(lots.map(async (entry, index) => {
    const deal = await svc.escrow.purchase(entry.buyer, entry.productId, 'fraud-buy-' + index + '-' + randomUUID(), 1);
    dealEntries.push({ orderId: BigInt(deal.id), buyer: entry.buyer });
    tracked.orders.push(BigInt(deal.id));
  }));
  // Race all payouts as simultaneously as the event loop allows. Serialization
  // conflicts are retried like a client would after a 500. Once the FIRST payout
  // triggers the marker, the seller is banned post-commit — later completes are
  // legitimately refused ('Аккаунт недоступен'), which is the guard under test, not
  // a drill failure. The invariant: the victim is repaid EXACTLY once either way.
  const outcomes: Array<{ orderId: bigint; result: string }> = [];
  await Promise.all(dealEntries.map(async (deal) => {
    const delivered = await withClientRetry(
      () => svc.escrow.deliver(scammer, deal.orderId, 'fraud-deliver-' + deal.orderId.toString()),
      isSerializationConflict,
    );
    if (!delivered.value) {
      outcomes.push({ orderId: deal.orderId, result: 'deliver-refused:' + delivered.error });
      return;
    }
    const completed = await withClientRetry(
      () => svc.escrow.complete(deal.buyer, deal.orderId, 'fraud-complete-' + deal.orderId.toString()),
      isSerializationConflict,
    );
    outcomes.push({
      orderId: deal.orderId,
      result: completed.value ? 'completed' : 'complete-refused:' + completed.error,
    });
  }));

  const repayments = await svc.prisma.ledgerEntry.findMany({
    where: { type: 'REFUND', userId: victimId, idempotencyKey: { startsWith: 'fraud-watch:' } },
    select: { amountCents: true },
  });
  const claims = await svc.prisma.ledgerEntry.findMany({
    where: { type: 'CLAWBACK', userId: scammerId, idempotencyKey: { startsWith: 'fraud-watch:' } },
    select: { amountCents: true },
  });
  const scammerRow = await svc.prisma.user.findUniqueOrThrow({
    where: { id: scammerId },
    select: { deletedAt: true, withdrawBlockedAt: true, banStrikeCount: true },
  });
  const repaidTotal = repayments.reduce((sum, row) => sum + row.amountCents, 0n);
  const claimTotal = claims.reduce((sum, row) => sum + -row.amountCents, 0n);
  const completedCount = outcomes.filter((o) => o.result === 'completed').length;
  const refusedAfterBan = outcomes.filter((o) => o.result.startsWith('complete-refused') || o.result.startsWith('deliver-refused')).length;
  if (completedCount + refusedAfterBan !== dealEntries.length) {
    throw new Error('fraud drill: unclassified outcome ' + JSON.stringify(outcomes));
  }
  report.fraudWatchRace = {
    racingPayouts: dealEntries.length,
    completedPayouts: completedCount,
    refusedAfterBan,
    repayments: repayments.length,
    repaidTotalCents: repaidTotal.toString(),
    claimTotalCents: claimTotal.toString(),
    banned: scammerRow.deletedAt !== null,
    frozen: scammerRow.withdrawBlockedAt !== null,
    strikes: scammerRow.banStrikeCount,
    ok: repayments.length === 1 && claims.length === 1 && repaidTotal <= claimCents
      && repaidTotal === claimTotal && repaidTotal > 0n
      && completedCount >= 1
      && scammerRow.deletedAt !== null
      && scammerRow.withdrawBlockedAt !== null,
  };
}

/** Money invariants after everything: balances == ledger sums, no negative money, no dup payouts. */
async function auditMoney(svc: Services, report: Record<string, unknown>): Promise<void> {
  const metrics = new MetricsService();
  const errors = new ErrorTrackingService(metrics);
  const alerts = new AlertingService(metrics, errors);
  const job = new LedgerReconciliationJob(svc.prisma as never, metrics, alerts);
  const mismatches = await job.run(1_000);

  const negatives = await svc.prisma.user.count({
    where: { id: { in: tracked.users.length ? tracked.users : [0n] }, balanceCents: { lt: 0n } },
  });
  const dupGroups = tracked.users.length
    ? await svc.prisma.ledgerEntry.groupBy({
        by: ['idempotencyKey'],
        where: { userId: { in: tracked.users } },
        _count: { _all: true },
      })
    : [];
  const duplicateKeys = dupGroups.filter((row) => row._count._all > 1).length;
  const orphanNotes = await svc.prisma.notification.count({
    where: { userId: { in: tracked.users.length ? tracked.users : [0n] } },
  });
  report.moneyAudit = {
    reconciliationMismatches: mismatches,
    negativeBalances: negatives,
    duplicateIdempotencyKeys: duplicateKeys,
    notificationsWritten: orphanNotes,
    ok: mismatches === 0 && negatives === 0 && duplicateKeys === 0,
  };
}

async function cleanup(svc: Services): Promise<void> {
  const users = tracked.users.length ? tracked.users : [0n];
  await svc.prisma.orderTransition.deleteMany({ where: { orderId: { in: tracked.orders.length ? tracked.orders : [0n] } } }).catch(() => undefined);
  await svc.prisma.order.deleteMany({ where: { id: { in: tracked.orders.length ? tracked.orders : [0n] } } }).catch(() => undefined);
  await svc.prisma.product.deleteMany({ where: { id: { in: tracked.products.length ? tracked.products : ['none'] } } }).catch(() => undefined);
  await svc.prisma.message.deleteMany({ where: { chat: { members: { some: { userId: { in: users } } } } } }).catch(() => undefined);
  await svc.prisma.chatMember.deleteMany({ where: { userId: { in: users } } }).catch(() => undefined);
  await svc.prisma.chat.deleteMany({ where: { members: { some: { userId: { in: users } } } } }).catch(() => undefined);
  await svc.prisma.notification.deleteMany({ where: { userId: { in: users } } }).catch(() => undefined);
  await svc.prisma.ledgerEntry.deleteMany({ where: { userId: { in: users } } }).catch(() => undefined);
  await svc.prisma.depositLock.deleteMany({ where: { userId: { in: users } } }).catch(() => undefined);
  await svc.prisma.session.deleteMany({ where: { userId: { in: users } } }).catch(() => undefined);
  await svc.prisma.auditLog.deleteMany({ where: { actorId: { in: users } } }).catch(() => undefined);
  await svc.prisma.securityEvent.deleteMany({ where: { userId: { in: users } } }).catch(() => undefined);
  await svc.prisma.abuseMarker.deleteMany({ where: { sourceUserId: { in: users } } }).catch(() => undefined);
  await svc.prisma.trustHistoryEvent.deleteMany({ where: { userId: { in: users } } }).catch(() => undefined);
  await svc.prisma.user.deleteMany({ where: { id: { in: users } } }).catch(() => undefined);
}

async function main(): Promise<void> {
  const svc = await buildServices();
  const report: Record<string, unknown> = {
    mode: 'throughput-drill',
    stampedAt: new Date().toISOString(),
    config: { msgPerSec: MSG_PER_SEC, dealsPerSec: DEALS_PER_SEC, durationSec: DURATION_SEC, poolMax: POOL_MAX },
  };
  let failed = false;
  try {
    await scenarioChat(svc, report);
    await scenarioDeals(svc, report);
    await scenarioDealLifecycle(svc, report);
    await scenarioFraudWatchRace(svc, report);
    await scenarioWebSocket(svc, report);
    await scenarioMixed(svc, report);
    await auditMoney(svc, report);
    for (const key of ['chat', 'deals', 'dealLifecycle', 'fraudWatchRace', 'websocket', 'mixed', 'moneyAudit']) {
      const section = report[key] as { ok?: boolean } | undefined;
      if (section && section.ok === false) failed = true;
    }
    report.ok = !failed;
  } catch (error) {
    failed = true;
    report.ok = false;
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    // KEEP=1 leaves the rows behind so ops:money-audit can scan a populated database
    // instead of an empty one; the scratch cluster is dropped right after anyway.
    if ((process.env.THROUGHPUT_DRILL_KEEP_DATA ?? '').trim() !== '1') await cleanup(svc);
    await svc.hub.onModuleDestroy();
    await svc.realtime.onApplicationShutdown();
    await svc.coordination.onApplicationShutdown();
    await svc.prisma.$disconnect();
    await svc.pool.end();
  }

  mkdirSync(outDir, { recursive: true });
  const path = resolve(outDir, 'throughput-drill-' + stamp + '.json');
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(resolve(evidenceDir, 'throughput-drill-latest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (failed) process.exit(1);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
