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
const TELEGRAM_WEB_ORIGINS = new Set([
  'https://web.telegram.org',
  'https://k.web.telegram.org',
]);

type SocketState = {
  ws: WebSocket;
  user: RealtimeAuthUser | null;
  chats: Set<string>;
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
    for (const state of this.sockets) {
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

    const state: SocketState = { ws, user: null, chats: new Set(), alive: true, peerIp, unauthSlot: true };
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
        state.chats.delete(msg.chatId);
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
      // Drop oldest
      const oldest = existing.values().next().value;
      if (oldest) {
        try { oldest.ws.close(1000, 'replaced'); } catch { /* ignore */ }
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
    // Announce online immediately on WS auth (works even if HTTP presence is throttled in background tabs).
    void this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    }).then(() => {
      this.bus.publish({
        kind: 'presence',
        userId: user.id,
        onixId: user.onixId,
        online: true,
        lastOnline: new Date().toISOString(),
        watchers: [],
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
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: id, userId: state.user.id } },
      select: { chatId: true },
    });
    if (!member) {
      this.send(state.ws, { type: 'error', code: 'REALTIME_FORBIDDEN', message: 'Not a chat member.' });
      return;
    }
    state.chats.add(id);
  }

  private async emitTyping(state: SocketState, chatId: string): Promise<void> {
    if (!state.user || !state.chats.has(chatId)) return;
    const members = await this.prisma.chatMember.findMany({
      where: { chatId, userId: { not: state.user.id } },
      select: { userId: true },
      take: 50,
    });
    const user = await this.prisma.user.findUnique({
      where: { id: state.user.id },
      select: { onixId: true, displayName: true },
    });
    if (!user) return;
    this.bus.publish({
      kind: 'chat.typing',
      chatId,
      recipientUserIds: members.map((m) => m.userId),
      userId: state.user.id,
      onixId: user.onixId,
      username: publicDisplayName(user.displayName, user.onixId),
    });
  }

  private async markChatRead(state: SocketState, chatId: string): Promise<void> {
    if (!state.user) return;
    const id = chatId.trim();
    if (!id || id.length > 64) {
      this.send(state.ws, { type: 'error', code: 'REALTIME_BAD_CHAT', message: 'Invalid chatId.' });
      return;
    }
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: id, userId: state.user.id } },
      select: { chatId: true },
    });
    if (!member) {
      this.send(state.ws, { type: 'error', code: 'REALTIME_FORBIDDEN', message: 'Not a chat member.' });
      return;
    }
    const lastReadAt = new Date();
    await this.prisma.chatMember.update({
      where: { chatId_userId: { chatId: id, userId: state.user.id } },
      data: { lastReadAt },
    });
    const others = await this.prisma.chatMember.findMany({
      where: { chatId: id, userId: { not: state.user.id } },
      select: { userId: true },
      take: 50,
    });
    const user = await this.prisma.user.findUnique({
      where: { id: state.user.id },
      select: { onixId: true, displayName: true },
    });
    if (!user) return;
    this.bus.publish({
      kind: 'chat.read',
      chatId: id,
      userId: state.user.id,
      onixId: user.onixId,
      username: publicDisplayName(user.displayName, user.onixId),
      lastReadAt: lastReadAt.toISOString(),
      recipientUserIds: [state.user.id, ...others.map((m) => m.userId)],
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
      const payload: RealtimeServerMessage = {
        type: 'presence',
        userId: event.userId.toString(),
        onixId: event.onixId,
        online: event.online,
        lastOnline: event.lastOnline,
      };
      // Market avatars + chats need live presence — broadcast to all connected users (single-node).
      this.broadcast(payload);
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
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  private detach(state: SocketState, opts?: { silent?: boolean }): void {
    if (state.authTimer) clearTimeout(state.authTimer);
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
      this.bus.publish({
        kind: 'presence',
        userId: user.id,
        onixId: user.onixId,
        online: false,
        lastOnline: new Date().toISOString(),
        watchers: [],
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
