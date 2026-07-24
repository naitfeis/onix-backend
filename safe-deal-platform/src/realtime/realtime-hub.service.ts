import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { PrismaService } from '../prisma.service';
import { resolveCorsOrigins } from '../security-headers';
import { publicDisplayName } from '../public-username';
import { structuredLog } from '../observability/structured-logger';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import { RealtimeAuthService, type RealtimeAuthUser } from './realtime-auth.service';
import { RealtimeBus } from './realtime-bus.service';
import type { RealtimeClientMessage, RealtimeServerMessage } from './realtime.types';

const AUTH_TIMEOUT_MS = 8_000;
const MAX_CONNECTIONS_PER_USER = Number(process.env.REALTIME_MAX_CONN_PER_USER ?? 5);
const MAX_TOTAL_CONNECTIONS = Number(process.env.REALTIME_MAX_CONNECTIONS ?? 2_000);
const PING_INTERVAL_MS = 25_000;

type SocketState = {
  ws: WebSocket;
  user: RealtimeAuthUser | null;
  chats: Set<string>;
  alive: boolean;
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

    const state: SocketState = { ws, user: null, chats: new Set(), alive: true };
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
      // Same-origin browser WS often sends Origin; non-browser may omit — allow only if no Origin
      // when not production, or allow omit (Telegram WebView quirks).
      return true;
    }
    const allowed = resolveCorsOrigins();
    return allowed.includes(origin);
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
        this.detach(oldest);
      }
    }
    state.user = user;
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

  private onBusEvent(event: import('./realtime.types').RealtimeBusEvent): void {
    if (event.kind === 'chat.message') {
      for (const [viewerKey, dto] of event.messageByViewer) {
        const viewerId = BigInt(viewerKey);
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
    if (event.kind === 'presence') {
      const payload: RealtimeServerMessage = {
        type: 'presence',
        userId: event.userId.toString(),
        onixId: event.onixId,
        online: event.online,
        lastOnline: event.lastOnline,
      };
      for (const id of event.watchers) this.sendToUser(id, payload);
      // Echo to self (profile lastOnline)
      this.sendToUser(event.userId, payload);
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
      const payload: RealtimeServerMessage = {
        type: 'order.updated',
        orderId: event.orderId,
        status: event.status,
        ...(event.chatId ? { chatId: event.chatId } : {}),
      };
      for (const id of event.recipientUserIds) this.sendToUser(id, payload);
    }
  }

  private sendToUser(userId: bigint, payload: RealtimeServerMessage): void {
    const set = this.byUser.get(userId.toString());
    if (!set) return;
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

  private detach(state: SocketState): void {
    if (state.authTimer) clearTimeout(state.authTimer);
    this.sockets.delete(state);
    if (state.user) {
      const key = state.user.id.toString();
      const set = this.byUser.get(key);
      if (set) {
        set.delete(state);
        if (set.size === 0) this.byUser.delete(key);
      }
    }
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
