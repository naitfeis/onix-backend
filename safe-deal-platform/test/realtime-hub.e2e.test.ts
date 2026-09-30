import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import WebSocket from 'ws';
import { RealtimeHubService } from '../src/realtime/realtime-hub.service';

/**
 * Realtime hub invariants over real ws sockets with a stubbed DB/auth, so every
 * assertion is about hub behaviour (fan-out, connection limits, backpressure,
 * per-frame query counts) and never about PostgreSQL.
 *
 * Hub limits are read at import time, so this file relies on the shipped defaults
 * (5 sockets per user, 1MB buffered cap). Node's ws client sends no Origin header;
 * allowing that here is deterministic regardless of NODE_ENV.
 */
process.env.REALTIME_ALLOW_NO_ORIGIN = '1';

type Counters = {
  memberLookup: number;
  peerLookup: number;
  readUpdate: number;
  userUpdate: number;
};

type PublishedEvent = { kind: string } & Record<string, unknown>;

type Harness = {
  hub: RealtimeHubService;
  counters: Counters;
  published: PublishedEvent[];
  emit: (event: Record<string, unknown>) => void;
  url: string;
  stop: (sockets: WebSocket[]) => Promise<void>;
};

async function startHarness(
  nextUserId: () => bigint,
  opts: { allowMembership?: boolean } = {},
): Promise<Harness> {
  const { allowMembership = true } = opts;
  const counters: Counters = { memberLookup: 0, peerLookup: 0, readUpdate: 0, userUpdate: 0 };
  const published: PublishedEvent[] = [];
  let handler: ((event: Record<string, unknown>) => void) | null = null;

  const auth = {
    authenticateAccessToken: async () => ({
      id: nextUserId(),
      onixId: 'ONIX1',
      displayName: 'Tester',
      isAdmin: false,
      sessionId: 'sess-1',
    }),
  };
  const bus = {
    publish: (event: PublishedEvent) => {
      published.push(event);
      handler?.(event);
    },
    subscribe: (fn: (event: Record<string, unknown>) => void) => {
      handler = fn;
      return () => { handler = null; };
    },
  };
  const prisma = {
    user: { update: async () => { counters.userUpdate += 1; return {}; } },
    chatMember: {
      findUnique: async () => {
        counters.memberLookup += 1;
        return allowMembership ? { chatId: 'c1' } : null;
      },
      findMany: async () => { counters.peerLookup += 1; return [{ userId: 999n }]; },
      update: async () => { counters.readUpdate += 1; return {}; },
    },
  };

  const hub = new RealtimeHubService(auth as never, bus as never, prisma as never);
  hub.onModuleInit();
  const server: Server = createServer();
  hub.attach(server as never);
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'hub bound a port');
  return {
    hub,
    counters,
    published,
    emit: (event) => handler?.(event),
    url: `ws://127.0.0.1:${address.port}/api/realtime`,
    stop: async (sockets) => {
      for (const socket of sockets) { try { socket.terminate(); } catch { /* gone */ } }
      hub.onModuleDestroy();
      await new Promise<void>((resolve) => { server.close(() => resolve()); });
    },
  };
}

type Frame = Record<string, unknown>;

type Client = {
  ws: WebSocket;
  frames: Frame[];
  closes: Array<{ code: number; reason: string }>;
  wait: (predicate: (frame: Frame) => boolean, timeoutMs?: number) => Promise<Frame>;
  send: (payload: Record<string, unknown>) => void;
};

async function open(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  const frames: Frame[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  ws.on('message', (raw) => { frames.push(JSON.parse(String(raw)) as Frame); });
  ws.on('close', (code, reason) => { closes.push({ code, reason: String(reason) }); });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const client: Client = {
    ws,
    frames,
    closes,
    send: (payload) => ws.send(JSON.stringify(payload)),
    wait: async (predicate, timeoutMs = 4000) => {
      const started = Date.now();
      for (;;) {
        const found = frames.find(predicate);
        if (found) return found;
        if (Date.now() - started > timeoutMs) {
          assert.fail(`timed out; frames seen: ${JSON.stringify(frames.map((f) => f.type))}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
  client.send({ type: 'auth', accessToken: 'token' });
  await client.wait((frame) => frame.type === 'ready');
  return client;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function presenceEvent(userId: bigint, online = true, onixId?: string): Record<string, unknown> {
  return {
    kind: 'presence',
    userId,
    onixId: onixId ?? `ONIX${userId}`,
    online,
    lastOnline: new Date().toISOString(),
  };
}

/** A payload big enough to push one socket past the 1MB buffered cap quickly. */
const BIG_BODY = 'x'.repeat(2000);

test('a sixth tab for one user is closed with 4001, not 1000, so the client stops reconnecting', async () => {
  const h = await startHarness(() => 42n);
  const sockets: WebSocket[] = [];
  try {
    const clients: Client[] = [];
    for (let i = 0; i < 6; i += 1) {
      const client = await open(h.url);
      clients.push(client);
      sockets.push(client.ws);
    }
    await sleep(300);
    assert.equal(h.hub['byUser'].get('42')?.size, 5, 'hub keeps at most 5 sockets per user');
    assert.equal(h.hub['sockets'].size, 5);
    const kicked = clients[0]!;
    assert.equal(kicked.ws.readyState, WebSocket.CLOSED, 'oldest socket was closed');
    assert.equal(kicked.closes.length, 1);
    // Code 1000 said "replaced" to the server but "normal shutdown" to the client,
    // so the client reconnected and kicked the newest tab back — an endless loop
    // (measured: 6 tabs -> 20 auth calls, 15 cycles, 20 DB writes in 10 seconds).
    assert.equal(kicked.closes[0]!.code, 4001);
    assert.equal(kicked.closes[0]!.reason, 'replaced');
    assert.ok(
      kicked.frames.some((frame) => frame.type === 'error' && frame.code === 'REALTIME_SUPERSEDED'),
      'kicked tab is told why before the close',
    );
  } finally {
    await h.stop(sockets);
  }
});

test('presence beats coalesce into one frame per socket per window', async () => {
  let id = 0;
  const h = await startHarness(() => BigInt(100 + (id += 1)));
  const sockets: WebSocket[] = [];
  try {
    const clients = [await open(h.url), await open(h.url), await open(h.url)];
    for (const client of clients) sockets.push(client.ws);
    await sleep(200);
    // Auth itself announces presence once per user; count only frames from here on.
    const baseline = clients.map((client) => client.frames.length);
    // Five beats for one user inside a flush window must not become five frames on
    // every socket — that was the quadratic path (sockets x10 -> sends/sec x100).
    for (let i = 0; i < 5; i += 1) h.emit(presenceEvent(7n));
    await sleep(700);
    const presenceFrames = clients[0]!.frames.slice(baseline[0]).filter(
      (frame) => frame.type === 'presence' || frame.type === 'presence.batch',
    );
    assert.equal(presenceFrames.length, 1, 'one coalesced presence frame, not one per beat');
    assert.equal(presenceFrames[0]!.type, 'presence', 'a single user stays a plain frame');
    assert.equal(presenceFrames[0]!.userId, '7');
  } finally {
    await h.stop(sockets);
  }
});

test('presence batch keeps only the newest state per user', async () => {
  let id = 0;
  const h = await startHarness(() => BigInt(200 + (id += 1)));
  const sockets: WebSocket[] = [];
  try {
    const clients = [await open(h.url), await open(h.url)];
    for (const client of clients) sockets.push(client.ws);
    await sleep(200);
    const baseline = clients[0]!.frames.length;
    h.emit(presenceEvent(11n, true));
    h.emit(presenceEvent(12n, true));
    h.emit(presenceEvent(11n, false));
    await sleep(700);
    const frames = clients[0]!.frames.slice(baseline).filter((frame) => frame.type === 'presence.batch') as
      Array<{ presence: Array<{ userId: string; online: boolean }> }>;
    assert.equal(frames.length, 1, 'several users collapse into one batch frame');
    const entries = frames[0]!.presence;
    assert.equal(entries.length, 2);
    const eleven = entries.find((entry) => entry.userId === '11');
    assert.equal(eleven?.online, false, 'last write wins for a user that flipped twice');
  } finally {
    await h.stop(sockets);
  }
});

test('typing does not hit the DB while the subscription cache is fresh', async () => {
  let id = 0;
  const h = await startHarness(() => BigInt(300 + (id += 1)));
  const sockets: WebSocket[] = [];
  try {
    const client = await open(h.url);
    sockets.push(client.ws);
    client.send({ type: 'subscribe_chat', chatId: 'c1' });
    await sleep(150);
    const afterSubscribe = { ...h.counters };
    assert.ok(afterSubscribe.memberLookup >= 1, 'subscribe authorizes membership once');
    assert.ok(afterSubscribe.peerLookup >= 1, 'subscribe resolves peers once');

    // 20 typing frames (one per keystroke burst). Was 2 queries each = 40 total.
    for (let i = 0; i < 20; i += 1) client.send({ type: 'typing', chatId: 'c1' });
    await sleep(300);
    assert.equal(h.counters.memberLookup, afterSubscribe.memberLookup, 'no membership query per typing frame');
    assert.equal(h.counters.peerLookup, afterSubscribe.peerLookup, 'no peer query per typing frame');
    assert.equal(h.published.filter((event) => event.kind === 'chat.typing').length, 20);
  } finally {
    await h.stop(sockets);
  }
});

test('typing for an unsubscribed chat neither publishes nor queries', async () => {
  const h = await startHarness(() => 500n);
  const sockets: WebSocket[] = [];
  try {
    const client = await open(h.url);
    sockets.push(client.ws);
    const before = h.published.length;
    client.send({ type: 'typing', chatId: 'other' });
    await sleep(200);
    assert.equal(h.published.length, before, 'unsubscribed chat cannot fan out typing');
    assert.equal(h.counters.peerLookup, 0);
  } finally {
    await h.stop(sockets);
  }
});

test('chat.read is throttled per socket but the trailing mark still lands', async () => {
  let id = 0;
  const h = await startHarness(() => BigInt(400 + (id += 1)));
  const sockets: WebSocket[] = [];
  try {
    const client = await open(h.url);
    sockets.push(client.ws);
    client.send({ type: 'subscribe_chat', chatId: 'c1' });
    await sleep(150);
    const baseline = h.counters.readUpdate;
    // The client fires one read mark per incoming message; a 30-message burst must
    // not become 30 UPDATE + fan-out pairs that all mean "this user is up to date".
    for (let i = 0; i < 30; i += 1) client.send({ type: 'chat.read', chatId: 'c1' });
    await sleep(150);
    const immediate = h.counters.readUpdate - baseline;
    assert.ok(immediate <= 2, `writes throttled, got ${immediate}`);
    await sleep(2600);
    const total = h.counters.readUpdate - baseline;
    assert.ok(total >= 2, `trailing mark persisted, got ${total}`);
    assert.ok(total <= 4, `write count bounded, got ${total}`);
    assert.ok(
      h.published.filter((event) => event.kind === 'chat.read').length <= 4,
      'fan-out is throttled too, not only the DB write',
    );
  } finally {
    await h.stop(sockets);
  }
});

test('a stalled socket is terminated instead of buffering without bound', async () => {
  let id = 0;
  const h = await startHarness(() => BigInt(600 + (id += 1)));
  const sockets: WebSocket[] = [];
  try {
    const client = await open(h.url);
    sockets.push(client.ws);
    const state = [...h.hub['sockets']][0]!;
    assert.ok(state.user, 'hub resolved the authenticated user');
    // Backpressure is created on the RECEIVING side: stop the client reading so TCP
    // fills the server send buffer and ws.bufferedAmount on the hub side grows.
    client.ws._socket.pause();
    for (let i = 0; i < 1200; i += 1) {
      h.emit({
        kind: 'notification',
        userId: state.user!.id,
        id: `n${i}`,
        title: 't',
        body: BIG_BODY,
        createdAt: new Date().toISOString(),
      });
    }
    await sleep(500);
    assert.ok(!h.hub['sockets'].has(state), 'overflowing socket was removed from the hub');
    assert.ok(state.ws.bufferedAmount < 8 * 1024 * 1024, `buffer stays bounded, got ${state.ws.bufferedAmount}`);
  } finally {
    await h.stop(sockets);
  }
});

/**
 * Backpressure decision logic, tested deterministically. A live socket on the
 * loopback adapter drains into kernel buffers, so ws.bufferedAmount stays near 0
 * in-process and cannot be driven over the cap reliably from a test. The policy
 * itself — which frames may be dropped and which must kill the socket — is what
 * needs a guarantee, so it is asserted against a stand-in socket.
 */
function fakeSocket(bufferedAmount: number) {
  const sent: string[] = [];
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount,
    sent,
    terminated: false,
    send: (payload: string) => { sent.push(payload); },
    terminate: () => { socket.terminated = true; },
  };
  return socket;
}

test('send() drops ambient frames but terminates on undeliverable ones when the buffer overflows', async () => {
  const h = await startHarness(() => 700n);
  try {
    const send = (socket: unknown, payload: Record<string, unknown>) =>
      h.hub['send'](socket as WebSocket, payload as never);

    // Under the cap: everything goes out.
    const healthy = fakeSocket(0);
    send(healthy, { type: 'presence', userId: '1', onixId: 'ONIX1', online: true, lastOnline: 'now' });
    send(healthy, { type: 'notification', id: 'n1', title: 't', body: 'b', createdAt: 'now' });
    assert.equal(healthy.sent.length, 2, 'both frames delivered while draining');
    assert.equal(healthy.terminated, false);

    // Over the cap: ambient frames are dropped silently, socket survives.
    const overloaded = fakeSocket(64 * 1024 * 1024);
    for (const droppable of ['presence', 'presence.batch', 'chat.typing', 'pong'] as const) {
      send(overloaded, { type: droppable } as unknown as Record<string, unknown>);
    }
    assert.equal(overloaded.sent.length, 0, 'droppable frames are shed under backpressure');
    assert.equal(overloaded.terminated, false, 'shedding ambient frames must not kill the socket');

    // A message that cannot be delivered must not be silently dropped — losing it
    // would mean a lost message. Terminate so the client reconnects and refetches.
    send(overloaded, { type: 'notification', id: 'n2', title: 't', body: 'b', createdAt: 'now' });
    assert.equal(overloaded.terminated, true, 'undeliverable payload terminates the socket');
    assert.equal(overloaded.sent.length, 0, 'terminated socket gets nothing buffered');
  } finally {
    await h.stop([]);
  }
});

test('unsubscribe_chat clears cached membership', async () => {
  let id = 0;
  const h = await startHarness(() => BigInt(800 + (id += 1)));
  const sockets: WebSocket[] = [];
  try {
    const client = await open(h.url);
    sockets.push(client.ws);
    client.send({ type: 'subscribe_chat', chatId: 'c1' });
    await sleep(150);
    const state = [...h.hub['sockets']][0]!;
    assert.equal(state.chats.size, 1);
    assert.equal(state.subscriptions.size, 1);
    client.send({ type: 'unsubscribe_chat', chatId: 'c1' });
    await sleep(100);
    assert.equal(state.chats.size, 0);
    assert.equal(state.subscriptions.size, 0, 'cached peers are dropped with the subscription');
  } finally {
    await h.stop(sockets);
  }
});

test('WS-auth presence announce is rate-limited per user', async () => {
  const h = await startHarness(() => 900n);
  const sockets: WebSocket[] = [];
  try {
    // Same user reconnecting: each auth used to cost 1 DB write + 1 broadcast,
    // multiplying a kick storm into DB and fan-out load.
    for (let i = 0; i < 5; i += 1) {
      const client = await open(h.url);
      sockets.push(client.ws);
      await sleep(30);
    }
    await sleep(300);
    assert.ok(h.counters.userUpdate <= 2, `presence announce coalesced, writes=${h.counters.userUpdate}`);
    const presenceCount = h.published.filter((event) => event.kind === 'presence').length;
    assert.ok(presenceCount <= 2, `presence publishes coalesced, got ${presenceCount}`);
  } finally {
    await h.stop(sockets);
  }
});

test('a non-member cannot subscribe to a chat', async () => {
  const h = await startHarness(() => 950n, { allowMembership: false });
  const sockets: WebSocket[] = [];
  try {
    const client = await open(h.url);
    sockets.push(client.ws);
    client.send({ type: 'subscribe_chat', chatId: 'secret' });
    const frame = await client.wait((candidate) => candidate.type === 'error');
    assert.equal(frame.code, 'REALTIME_FORBIDDEN');
    assert.equal(h.hub['sockets'].values().next().value?.chats.size, 0);
  } finally {
    await h.stop(sockets);
  }
});

test('going offline clears the announce throttle so a fast reconnect is visible again', async () => {
  const h = await startHarness(() => 910n);
  const sockets: WebSocket[] = [];
  try {
    // First connect announces presence online once.
    const first = await open(h.url);
    sockets.push(first.ws);
    await sleep(250);
    const onlineAfterFirst = h.published.filter((e) => e.kind === 'presence').length;
    assert.ok(onlineAfterFirst >= 1, 'first connect announces online');

    // Closing the last socket marks the user offline and must clear the throttle.
    first.ws.close(1000, 'tab closed');
    await sleep(300);
    assert.ok(
      h.published.some((e) => e.kind === 'presence' && e.online === false),
      'last socket gone publishes offline',
    );

    // Reconnecting inside the announce window must still be seen as online,
    // otherwise peers keep showing the user offline until the next 45s HTTP beat.
    const second = await open(h.url);
    sockets.push(second.ws);
    await sleep(300);
    const onlineAnnounces = h.published.filter((e) => e.kind === 'presence' && e.online !== false);
    assert.ok(onlineAnnounces.length >= 2, `reconnect re-announced online, got ${onlineAnnounces.length}`);
  } finally {
    await h.stop(sockets);
  }
});
test('WS auth is still required before any fan-out', async () => {
  const h = await startHarness(() => 960n);
  const sockets: WebSocket[] = [];
  try {
    const ws = new WebSocket(h.url);
    sockets.push(ws);
    const frames: Frame[] = [];
    ws.on('message', (raw) => { frames.push(JSON.parse(String(raw)) as Frame); });
    await new Promise<void>((resolve) => { ws.once('open', () => resolve()); });
    ws.send(JSON.stringify({ type: 'typing', chatId: 'c1' }));
    await sleep(200);
    assert.ok(
      frames.some((frame) => frame.type === 'error' && frame.code === 'REALTIME_UNAUTHENTICATED'),
      'unauthenticated frame is rejected',
    );
    assert.equal(h.published.filter((event) => event.kind === 'chat.typing').length, 0);
  } finally {
    await h.stop(sockets);
  }
});