import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { PrismaService } from '../prisma.service';
import { resolveCorsOrigins } from '../security-headers';
import { clientIpFromNodeRequest } from '../http/client-ip';
import { publicDisplayName } from '../public-username';
import { structuredLog } from '../observability/structured-logger';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import { RealtimeAuthService, type RealtimeAuthUser } from './realtime-auth.service';
import { RealtimeBus } from './realtime-bus.service';
import type { RealtimeClientMessage, RealtimeServerMessage } from './realtime.types';

const AUTH_TIMEOUT_MS = Number(process.env.REALTIME_AUTH_TIMEOUT_MS ?? 3_000);
const MAX_CONNECTIONS_PER_USER = Number(process.env.REALTIME_MAX_CONN_PER_USER ?? 5);
const MAX_TOTAL_CONNECTIONS = Number(process.env.REALTIME_MAX_CONNECTIONS ?? 2_000);
const MAX_UNAUTH_PER_IP = Number(process.env.REALTIME_MAX_UNAUTH_PER_IP ?? 8);
const PING_INTERVAL_MS = 25_000;
/**
 * Application-defined close code (4000–4999) meaning "a newer socket for this
 * user replaced you". The client must NOT reconnect on it — otherwise an extra
 * tab creates an endless kick/reconnect loop, and every cycle costs one auth,
 * one DB write and one fan-out (measured: 6 tabs → 20 auth calls in 10s).
 */
const CLOSE_SUPERSEDED = 4001;
/**
 * Drop a socket whose outbound buffer exceeds this many bytes. Without a bound,
 * one stalled client grew the process by ~42MB / 16MB buffered (measured) and
 * stayed OPEN forever, since HTTP is the source of truth a reconnect + refetch
 * recovers everything the client missed.
 */
const MAX_BUFFERED_BYTES = Number(process.env.REALTIME_MAX_BUFFERED_BYTES ?? 1_048_576);
/** Frames that may be dropped instead of killing a slow socket. */
const DROPPABLE_ON_BACKPRESSURE = new Set(['presence', 'presence.batch', 'chat.typing', 'pong']);
/**
 * Presence fan-out coalescing window. Small enough that "online" feels instant,
 * large enough to collapse a reconnect storm into one frame per socket.
 */
const PRESENCE_FLUSH_MS = Number(process.env.REALTIME_PRESENCE_FLUSH_MS ?? 150);
/** Min interval between WS-auth presence announces for one user. */
const AUTH_PRESENCE_MIN_MS = Number(process.env.REALTIME_PRESENCE_ANNOUNCE_MIN_MS ?? 10_000);
const lastAuthPresenceAt = new Map<string, number>();
const TELEGRAM_WEB_ORIGINS = new Set([
  'https://web.telegram.org',
  'https://k.web.telegram.org',
]);

/** One queued presence beat; `type` is added when the frame is actually sent. */
type PresenceEntry = {
  userId: string;
  onixId: string;
  online: boolean;
  lastOnline: string;
};

/** Membership is authorized once per subscribe and cached for fan-out (bounded TTL). */
const CHAT_PEERS_CACHE_TTL_MS = 60_000;
/** Min interval between persisted read marks for one (socket, chat) pair. */
const READ_MARK_MIN_MS = Number(process.env.REALTIME_READ_MARK_MIN_MS ?? 2_000);

type ChatSubscription = {
  /** Other members, resolved at subscribe time — used for typing / read fan-out. */
  peerIds: bigint[];
  resolvedAt: number;
};

type SocketState = {
  ws: WebSocket;
  user: RealtimeAuthUser | null;
  chats: Set<string>;
  /** chatId → cached membership for fan-out (re-validated after TTL). */
  subscriptions: Map<string, ChatSubscription>;
  /** chatId → last persisted lastReadAt write, to stop write amplification. */
  readMarks: Map<string, number>;
  /** Pending trailing read marks so a throttled mark still lands. */
  readTimers: Map<string, NodeJS.Timeout>;
  alive: boolean;
  peerIp?: string;
  unauthSlot?: boolean;
  authTimer?: NodeJS.Timeout;
};

/**
 * Raw WebSocket hub on `/api/realtime`.
 * Auth via first `auth` message with access JWT (same as HTTP Bearer).
 */
@Injectable()
export class RealtimeHubService implements OnModuleInit, OnModuleDestroy {
  private wss: WebSocketServer | null = null;
  private readonly sockets = new Set<SocketState>();
  private readonly byUser = new Map<string, Set<SocketState>>();
  private readonly unauthByIp = new Map<string, number>();
  private unsubscribeBus: (() => void) | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private presenceFlushTimer: NodeJS.Timeout | null = null;
  /**
   * Pending presence per socket, keyed by user id so a user who flips
   * online→offline inside one window collapses to the newest state.
   *
   * Without this, every presence beat is sent to every connected socket:
   * measured 100 sends per event at N=100 and 1000 at N=1000, i.e. sockets ×10
   * gave sends/sec ×100 — quadratic in concurrent users.
   */
  private presencePending = new Map<SocketState, Map<string, PresenceEntry>>();

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly bus: RealtimeBus,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.unsubscribeBus = this.bus.subscribe((event) => this.onBusEvent(event));
  }

  onModuleDestroy(): void {
    this.unsubscribeBus?.();
    this.unsubscribeBus = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.presenceFlushTimer) clearTimeout(this.presenceFlushTimer);
    this.presenceFlushTimer = null;
    this.presencePending.clear();
    for (const state of this.sockets) {
      for (const timer of state.readTimers.values()) clearTimeout(timer);
      state.readTimers.clear();
      try { state.ws.close(1001, 'shutdown'); } catch { /* ignore */ }
    }
    this.sockets.clear();
    this.byUser.clear();
    this.wss?.close();
    this.wss = null;
  }

  attach(server: HttpServer): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({
      server,
      path: '/api/realtime',
      maxPayload: 16_384,
    });

    this.wss.on('connection', (ws, req) => {
      void this.handleConnection(ws, req);
    });

    this.pingTimer = setInterval(() => this.heartbeat(), PING_INTERVAL_MS);
    this.pingTimer.unref?.();
    structuredLog.info('realtime hub attached', { path: '/api/realtime' });
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    if (this.sockets.size >= MAX_TOTAL_CONNECTIONS) {
      this.send(ws, { type: 'error', code: 'REALTIME_CAPACITY', message: 'Too many connections.' });
      ws.close(1013, 'capacity');
      return;
    }

    if (!this.originAllowed(req)) {
      this.send(ws, { type: 'error', code: 'REALTIME_ORIGIN', message: 'Origin not allowed.' });
      ws.close(1008, 'origin');
      return;
    }

    const peerIp = clientIpFromNodeRequest(req) ?? 'unknown';
    const unauth = this.unauthByIp.get(peerIp) ?? 0;
    if (unauth >= MAX_UNAUTH_PER_IP) {
      this.send(ws, { type: 'error', code: 'REALTIME_IP_LIMIT', message: 'Too many connections from this IP.' });
      ws.close(1013, 'ip limit');
      return;
    }
    this.unauthByIp.set(peerIp, unauth + 1);

    const state: SocketState = {
      ws,
      user: null,
      chats: new Set(),
      subscriptions: new Map(),
      readMarks: new Map(),
      readTimers: new Map(),
      alive: true,
      peerIp,
      unauthSlot: true,
    };
    this.sockets.add(state);

    state.authTimer = setTimeout(() => {
      if (!state.user) {
        this.send(ws, { type: 'error', code: 'REALTIME_AUTH_TIMEOUT', message: 'Auth required.' });
        ws.close(1008, 'auth timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('pong', () => { state.alive = true; });
    ws.on('close', () => this.detach(state));
    ws.on('error', () => this.detach(state));
    ws.on('message', (raw) => {
      void this.onMessage(state, raw);
    });
  }

  private originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) {
      const allowMissing = (process.env.REALTIME_ALLOW_NO_ORIGIN ?? '').trim().toLowerCase();
      if (allowMissing === '1' || allowMissing === 'true') return true;
      if ((process.env.NODE_ENV ?? '').toLowerCase() === 'production') return false;
      return true;
    }
    if (TELEGRAM_WEB_ORIGINS.has(origin)) return true;
    const allowed = resolveCorsOrigins();
    if (allowed.includes(origin)) return true;
    // Same-host as this request (Render custom domain / www vs apex already in CORS;
    // also covers accidental Host-only mismatch behind Cloudflare).
    try {
      const host = req.headers.host?.split(':')[0];
      const originHost = new URL(origin).hostname;
      if (host && originHost && host === originHost) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  private async onMessage(state: SocketState, raw: RawData): Promise<void> {
    let msg: RealtimeClientMessage;
    try {
      msg = JSON.parse(String(raw)) as RealtimeClientMessage;
    } catch {
      this.send(state.ws, { type: 'error', code: 'REALTIME_BAD_JSON', message: 'Invalid JSON.' });
      return;
    }

    if (!msg || typeof msg !== 'object' || !('type' in msg)) {
      this.send(state.ws, { type: 'error', code: 'REALTIME_BAD_MESSAGE', message: 'Invalid message.' });
      return;
    }

    try {
      if (msg.type === 'auth') {
        await this.authenticate(state, msg.accessToken);
        return;
      }
      if (!state.user) {
        this.send(state.ws, { type: 'error', code: 'REALTIME_UNAUTHENTICATED', message: 'Authenticate first.' });
        return;
      }
      if (msg.type === 'ping') {
        state.alive = true;
        this.send(state.ws, { type: 'pong', ts: Date.now() });
        return;
      }
      if (msg.type === 'subscribe_chat') {
        await this.subscribeChat(state, msg.chatId);
        return;
      }
      if (msg.type === 'unsubscribe_chat') {
        this.dropChat(state, msg.chatId);
        return;
      }
      if (msg.type === 'typing') {
        await this.emitTyping(state, msg.chatId);
        return;
      }
      if (msg.type === 'chat.read') {
        await this.markChatRead(state, msg.chatId);
        return;
      }
    } catch (err) {
      const code = err instanceof AuthPlatformError ? err.code : 'REALTIME_ERROR';
      const message = err instanceof Error ? err.message : 'Realtime error';
      this.send(state.ws, { type: 'error', code, message });
      if (msg.type === 'auth') {
        state.ws.close(1008, 'auth failed');
      }
    }
  }

  private async authenticate(state: SocketState, accessToken: string): Promise<void> {
    const user = await this.auth.authenticateAccessToken(accessToken);
    const key = user.id.toString();
    const existing = this.byUser.get(key) ?? new Set();
    if (existing.size >= MAX_CONNECTIONS_PER_USER) {
      // Drop oldest with a code the client recognises as "do not reconnect".
      const oldest = existing.values().next().value;
      if (oldest) {
        this.send(oldest.ws, {
          type: 'error',
          code: 'REALTIME_SUPERSEDED',
          message: 'Replaced by a newer tab.',
        });
        try { oldest.ws.close(CLOSE_SUPERSEDED, 'replaced'); } catch { /* ignore */ }
        this.detach(oldest, { silent: true });
      }
    }
    state.user = user;
    this.releaseUnauthSlot(state);
    if (state.authTimer) {
      clearTimeout(state.authTimer);
      state.authTimer = undefined;
    }
    let set = this.byUser.get(key);
    if (!set) {
      set = new Set();
      this.byUser.set(key, set);
    }
    set.add(state);
    this.send(state.ws, { type: 'ready', userId: key });
    this.announceOnline(user);
  }

  /**
   * Announce online on WS auth (works even if HTTP presence is throttled in
   * background tabs), but at most once per user per window: each announce is one
   * DB write plus a fan-out to every connected socket, so reconnect loops used to
   * multiply both without changing any visible state.
   */
  private announceOnline(user: RealtimeAuthUser): void {
    const key = user.id.toString();
    const now = Date.now();
    const last = lastAuthPresenceAt.get(key) ?? 0;
    if (now - last < AUTH_PRESENCE_MIN_MS) return;
    lastAuthPresenceAt.set(key, now);
    if (lastAuthPresenceAt.size > 20_000) {
      const oldest = lastAuthPresenceAt.keys().next().value;
      if (oldest) lastAuthPresenceAt.delete(oldest);
    }
    void this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    }).then(() => {
      this.bus.publish({
        kind: 'presence',
        userId: user.id,
        onixId: user.onixId,
        online: true,
        lastOnline: new Date(now).toISOString(),
      });
    }).catch(() => { /* ignore */ });
  }

  private async subscribeChat(state: SocketState, chatId: string): Promise<void> {
    if (!state.user) return;
    const id = chatId.trim();
    if (!id || id.length > 64) {
      this.send(state.ws, { type: 'error', code: 'REALTIME_BAD_CHAT', message: 'Invalid chatId.' });
      return;
    }
    // One membership query + one peer query per subscribe. Typing and read marks
    // then fan out from this cache instead of re-running both on every frame.
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: id, userId: state.user.id } },
      select: { chatId: true },
    });
    if (!member) {
      this.send(state.ws, { type: 'error', code: 'REALTIME_FORBIDDEN', message: 'Not a chat member.' });
      return;
    }
    const peerIds = await this.loadPeerIds(id, state.user.id);
    state.chats.add(id);
    state.subscriptions.set(id, { peerIds, resolvedAt: Date.now() });
  }

  /** Other members of a chat; cached per subscription with a bounded TTL. */
  private async loadPeerIds(chatId: string, selfId: bigint): Promise<bigint[]> {
    const rows = await this.prisma.chatMember.findMany({
      where: { chatId, userId: { not: selfId } },
      select: { userId: true },
      take: 50,
    });
    return rows.map((row) => row.userId);
  }

  /**
   * Peer list for fan-out. Membership was authorized at subscribe time; the list
   * is refreshed after TTL so a newly added member is not silently excluded.
   */
  private async peerIdsFor(state: SocketState, chatId: string): Promise<bigint[] | null> {
    if (!state.user) return null;
    const cached = state.subscriptions.get(chatId);
    const now = Date.now();
    if (cached && now - cached.resolvedAt < CHAT_PEERS_CACHE_TTL_MS) return cached.peerIds;
    // Re-validate membership before refreshing, so a removed member stops fan-out.
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: state.user.id } },
      select: { chatId: true },
    });
    if (!member) {
      state.chats.delete(chatId);
      state.subscriptions.delete(chatId);
      return null;
    }
    const peerIds = await this.loadPeerIds(chatId, state.user.id);
    state.subscriptions.set(chatId, { peerIds, resolvedAt: now });
    return peerIds;
  }

  private dropChat(state: SocketState, chatId: string): void {
    state.chats.delete(chatId);
    state.subscriptions.delete(chatId);
    const timer = state.readTimers.get(chatId);
    if (timer) {
      clearTimeout(timer);
      state.readTimers.delete(chatId);
    }
    state.readMarks.delete(chatId);
  }

  /**
   * Hottest realtime path: one frame per typing user per chat every ~1.2s.
   * Zero DB queries when the subscription cache is fresh (was 2 per frame).
   */
  private async emitTyping(state: SocketState, chatId: string): Promise<void> {
    if (!state.user || !state.chats.has(chatId)) return;
    const peerIds = await this.peerIdsFor(state, chatId);
    if (!peerIds || peerIds.length === 0) return;
    this.bus.publish({
      kind: 'chat.typing',
      chatId,
      recipientUserIds: peerIds,
      userId: state.user.id,
      onixId: state.user.onixId,
      username: publicDisplayName(state.user.displayName, state.user.onixId),
    });
  }

  /**
   * Read receipts are the second-hottest path: the client fires one on every
   * incoming message it is viewing, so an active thread produces a continuous
   * stream of UPDATE + fan-out pairs that all carry the same meaning
   * ("this user is up to date"). Persist at most once per window and coalesce the
   * tail so the final mark always lands.
   */
  private async markChatRead(state: SocketState, chatId: string): Promise<void> {
    if (!state.user) return;
    const id = chatId.trim();
    if (!id || id.length > 64) {
      this.send(state.ws, { type: 'error', code: 'REALTIME_BAD_CHAT', message: 'Invalid chatId.' });
      return;
    }
    const now = Date.now();
    const lastWrite = state.readMarks.get(id) ?? 0;
    if (now - lastWrite < READ_MARK_MIN_MS) {
      this.scheduleTrailingReadMark(state, id);
      return;
    }
    await this.persistAndPublishRead(state, id, now);
  }

  private scheduleTrailingReadMark(state: SocketState, chatId: string): void {
    if (state.readTimers.has(chatId)) return;
    const timer = setTimeout(() => {
      state.readTimers.delete(chatId);
      void this.persistAndPublishRead(state, chatId, Date.now());
    }, READ_MARK_MIN_MS);
    timer.unref?.();
    state.readTimers.set(chatId, timer);
  }

  private async persistAndPublishRead(state: SocketState, id: string, nowMs: number): Promise<void> {
    if (!state.user) return;
    // Claim the window BEFORE the first await. A burst of read marks arrives in one
    // tick, and checking-then-claiming across an await let every frame in the burst
    // pass the throttle (measured: 30 marks -> 30 UPDATE + fan-out pairs).
    state.readMarks.set(id, nowMs);
    const peerIds = await this.peerIdsFor(state, id);
    if (!peerIds) {
      state.readMarks.delete(id);
      this.send(state.ws, { type: 'error', code: 'REALTIME_FORBIDDEN', message: 'Not a chat member.' });
      return;
    }
    const lastReadAt = new Date(nowMs);
    await this.prisma.chatMember.update({
      where: { chatId_userId: { chatId: id, userId: state.user.id } },
      data: { lastReadAt },
    });
    this.bus.publish({
      kind: 'chat.read',
      chatId: id,
      userId: state.user.id,
      onixId: state.user.onixId,
      username: publicDisplayName(state.user.displayName, state.user.onixId),
      lastReadAt: lastReadAt.toISOString(),
      recipientUserIds: [state.user.id, ...peerIds],
    });
  }

  private onBusEvent(event: import('./realtime.types').RealtimeBusEvent): void {
    if (event.kind === 'chat.message') {
      for (const [viewerKey, dto] of event.messageByViewer) {
        const viewerId = BigInt(viewerKey);
        // Sender already appended the HTTP response — echoing it over WS duplicates the bubble.
        if (viewerId === event.senderId) continue;
        const unreadDelta = viewerId === event.senderId ? undefined : 1;
        this.sendToUser(viewerId, {
          type: 'chat.message',
          chatId: event.chatId,
          message: dto,
          ...(unreadDelta ? { unreadDelta } : {}),
        });
      }
      return;
    }
    if (event.kind === 'chat.typing') {
      const payload: RealtimeServerMessage = {
        type: 'chat.typing',
        chatId: event.chatId,
        userId: event.userId.toString(),
        onixId: event.onixId,
        username: event.username,
      };
      for (const id of event.recipientUserIds) this.sendToUser(id, payload);
      return;
    }
    if (event.kind === 'chat.read') {
      const payload: RealtimeServerMessage = {
        type: 'chat.read',
        chatId: event.chatId,
        userId: event.userId.toString(),
        onixId: event.onixId,
        username: event.username,
        lastReadAt: event.lastReadAt,
      };
      for (const id of event.recipientUserIds) this.sendToUser(id, payload);
      return;
    }
    if (event.kind === 'presence') {
      // Market avatars + chats need live presence, so every connected user is a
      // recipient. Queue instead of sending: beats are coalesced into one frame
      // per socket per window, turning N²/beat-rate sends into N per window.
      this.queuePresence({
        userId: event.userId.toString(),
        onixId: event.onixId,
        online: event.online,
        lastOnline: event.lastOnline,
      });
      return;
    }
    if (event.kind === 'notification') {
      this.sendToUser(event.userId, {
        type: 'notification',
        id: event.id,
        title: event.title,
        body: event.body,
        createdAt: event.createdAt,
        ...(event.data ? { data: event.data } : {}),
      });
      return;
    }
    if (event.kind === 'order.updated') {
      const soundIds = new Set((event.soundUserIds ?? []).map((id) => id.toString()));
      for (const id of event.recipientUserIds) {
        this.sendToUser(id, {
          type: 'order.updated',
          orderId: event.orderId,
          status: event.status,
          ...(event.chatId ? { chatId: event.chatId } : {}),
          ...(soundIds.has(id.toString()) ? { sound: 'order' as const } : {}),
        });
      }
      return;
    }
    if (event.kind === 'product.changed') {
      this.broadcast({
        type: 'product.changed',
        productId: event.productId,
        status: event.status,
        quantity: event.quantity,
        ...(event.created ? { created: true } : {}),
      });
    }
  }

  private broadcast(payload: RealtimeServerMessage): void {
    for (const set of this.byUser.values()) {
      for (const state of set) this.send(state.ws, payload);
    }
  }

  /** Queue one presence beat for every connected socket; flushed as one batch. */
  private queuePresence(entry: { userId: string; onixId: string; online: boolean; lastOnline: string }): void {
    let queued = 0;
    for (const state of this.sockets) {
      if (state.ws.readyState !== WebSocket.OPEN) continue;
      let pending = this.presencePending.get(state);
      if (!pending) {
        pending = new Map();
        this.presencePending.set(state, pending);
      }
      pending.set(entry.userId, entry);
      queued += 1;
    }
    if (queued === 0) return;
    if (this.presenceFlushTimer) return;
    this.presenceFlushTimer = setTimeout(() => this.flushPresence(), PRESENCE_FLUSH_MS);
    this.presenceFlushTimer.unref?.();
  }

  private flushPresence(): void {
    this.presenceFlushTimer = null;
    if (this.presencePending.size === 0) return;
    const batches = this.presencePending;
    this.presencePending = new Map();
    for (const [state, pending] of batches) {
      if (state.ws.readyState !== WebSocket.OPEN) continue;
      const presence = [...pending.values()];
      // Single beat stays a plain frame — one entry needs no envelope.
      if (presence.length === 1) {
        this.send(state.ws, { type: 'presence', ...presence[0]! });
        continue;
      }
      this.send(state.ws, { type: 'presence.batch', presence });
    }
  }

  private sendToUser(userId: bigint, payload: RealtimeServerMessage): void {
    const set = this.byUser.get(userId.toString());
    if (!set || set.size === 0) {
      if (payload.type === 'chat.message' || payload.type === 'order.updated') {
        structuredLog.info('realtime deliver: user offline', {
          userId: userId.toString(),
          type: payload.type,
        });
      }
      return;
    }
    for (const state of set) {
      // chat.message / typing: if subscribed to chats, prefer only open chats for typing;
      // messages always delivered to user channel (inbox).
      if (payload.type === 'chat.typing' && state.chats.size > 0 && !state.chats.has(payload.chatId)) {
        continue;
      }
      this.send(state.ws, payload);
    }
  }

  private send(ws: WebSocket, payload: RealtimeServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Backpressure: a socket that cannot drain is either a dead half-open peer or
    // a client on a very slow link. Unbounded buffering grew the process without
    // limit; instead drop ambient frames and terminate on sustained overflow so
    // the client reconnects and resyncs over HTTP.
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      if (DROPPABLE_ON_BACKPRESSURE.has(payload.type)) return;
      structuredLog.warn('realtime socket buffer overflow — terminating', {
        bufferedBytes: ws.bufferedAmount,
        limit: MAX_BUFFERED_BYTES,
        frameType: payload.type,
      });
      try { ws.terminate(); } catch { /* ignore */ }
      return;
    }
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  private detach(state: SocketState, opts?: { silent?: boolean }): void {
    if (state.authTimer) clearTimeout(state.authTimer);
    for (const timer of state.readTimers.values()) clearTimeout(timer);
    state.readTimers.clear();
    state.readMarks.clear();
    state.subscriptions.clear();
    state.chats.clear();
    this.presencePending.delete(state);
    this.releaseUnauthSlot(state);
    this.sockets.delete(state);
    const user = state.user;
    if (!user) return;
    const key = user.id.toString();
    const set = this.byUser.get(key);
    if (set) {
      set.delete(state);
      if (set.size === 0) this.byUser.delete(key);
    }
    // Last socket gone → mark offline for market/chat peers.
    if (!opts?.silent && !this.byUser.has(key)) {
      // Clear the announce throttle here. It exists to collapse reconnect storms,
      // not to strand a user as "offline": without this, a close+reopen inside the
      // window skipped the re-announce and peers kept showing offline until the
      // next 45s HTTP presence beat.
      lastAuthPresenceAt.delete(key);
      this.bus.publish({
        kind: 'presence',
        userId: user.id,
        onixId: user.onixId,
        online: false,
        lastOnline: new Date().toISOString(),
      });
    }
  }

  private releaseUnauthSlot(state: SocketState): void {
    if (!state.unauthSlot || !state.peerIp) return;
    state.unauthSlot = false;
    const n = this.unauthByIp.get(state.peerIp) ?? 0;
    if (n <= 1) this.unauthByIp.delete(state.peerIp);
    else this.unauthByIp.set(state.peerIp, n - 1);
  }

  private heartbeat(): void {
    for (const state of this.sockets) {
      if (!state.alive) {
        try { state.ws.terminate(); } catch { /* ignore */ }
        this.detach(state);
        continue;
      }
      state.alive = false;
      try { state.ws.ping(); } catch { this.detach(state); }
    }
  }
}
