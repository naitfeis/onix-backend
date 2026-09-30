/**
 * Stage 5.6 realtime client — same-origin WebSocket `/api/realtime`.
 * HTTP remains source of truth; this channel only receives fan-out events.
 */

export type RealtimeInbound =
  | { type: 'ready'; userId: string }
  | { type: 'pong'; ts: number }
  | { type: 'error'; code: string; message: string }
  | { type: 'chat.message'; chatId: string; message: unknown; unreadDelta?: number }
  | { type: 'chat.typing'; chatId: string; userId: string; onixId: string; username: string }
  | { type: 'chat.read'; chatId: string; userId: string; onixId: string; username: string; lastReadAt: string }
  | { type: 'presence'; userId: string; onixId: string; online: boolean; lastOnline: string }
  | { type: 'presence.batch'; presence: Array<{ userId: string; onixId: string; online: boolean; lastOnline: string }> }
  | { type: 'notification'; id: string; title: string; body: string; createdAt: string; data?: Record<string, unknown> }
  | { type: 'order.updated'; orderId: string; status: string; chatId?: string; sound?: 'order' }
  | {
      type: 'product.changed';
      productId: string;
      status: string;
      quantity: number;
      created?: boolean;
    };

type Listener = (msg: RealtimeInbound) => void;
type TokenProvider = () => Promise<string | null>;
/**
 * Fires once the socket is authenticated again after an unintended drop, so
 * callers can refetch over HTTP. Events published while the socket was down are
 * not replayed by the server, so a refetch is the only way to close the gap.
 */
type ReconnectListener = () => void;
/** Server close code for "a newer tab replaced you" — must not trigger a reconnect. */
const CLOSE_SUPERSEDED = 4001;

function realtimeUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/realtime`;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private intentionalClose = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly reconnectListeners = new Set<ReconnectListener>();
  private tokenProvider: TokenProvider | null = null;
  private subscribedChats = new Set<string>();
  private ready = false;
  private authInFlight = false;
  private visibilityBound = false;
  /** True once the first socket authenticated; later `ready` events are re-syncs. */
  private everReady = false;
  /** Set when a drop was unintentional, so the next `ready` triggers a refetch. */
  private needsResync = false;
  /**
   * Set when the server closed this socket with CLOSE_SUPERSEDED because a newer
   * tab took the user's slot. Kept separate from `intentionalClose` so the tab can
   * still revive on explicit intent (connect() / becoming visible) while never
   * reconnecting from background timers — otherwise the two tabs kick each other
   * forever.
   */
  private superseded = false;

  /** True after server `ready` (authenticated). */
  isReady(): boolean {
    return this.ready && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Start (or restart) the socket. `getAccessToken` must return a fresh JWT
   * (refresh if expired) — HTTP already does this via AuthManager; WS must too.
   */
  connect(getAccessToken: TokenProvider): void {
    this.tokenProvider = getAccessToken;
    this.intentionalClose = false;
    // Explicit intent revives a superseded tab; background timers do not.
    this.superseded = false;
    this.bindVisibility();
    this.clearReconnectTimer();
    this.open();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.ready = false;
    this.everReady = false;
    this.needsResync = false;
    this.superseded = false;
    this.unbindVisibility();
    this.clearReconnectTimer();
    this.clearPingTimer();
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(1000, 'client disconnect'); } catch { /* ignore */ }
    }
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to post-reconnect resync signals (see ReconnectListener). */
  onReconnect(listener: ReconnectListener): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  subscribeChat(chatId: string): void {
    this.subscribedChats.add(chatId);
    this.send({ type: 'subscribe_chat', chatId });
  }

  unsubscribeChat(chatId: string): void {
    this.subscribedChats.delete(chatId);
    this.send({ type: 'unsubscribe_chat', chatId });
  }

  typing(chatId: string): void {
    this.send({ type: 'typing', chatId });
  }

  markRead(chatId: string): void {
    this.send({ type: 'chat.read', chatId });
  }

  /** True when a newer tab took this user's realtime slot (see CLOSE_SUPERSEDED). */
  isSuperseded(): boolean {
    return this.superseded;
  }

  private open(): void {
    if (this.intentionalClose || this.superseded || !this.tokenProvider) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.clearReconnectTimer();
    let ws: WebSocket;
    try {
      ws = new WebSocket(realtimeUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.ready = false;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      void this.authenticate();
      this.clearPingTimer();
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), 20_000);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      try {
        const msg = JSON.parse(String(ev.data)) as RealtimeInbound;
        if (msg.type === 'ready') {
          this.ready = true;
          for (const chatId of this.subscribedChats) {
            this.send({ type: 'subscribe_chat', chatId });
          }
          // Re-subscribed chats only receive NEW events; anything published while
          // the socket was down is gone (no server-side replay). Tell callers to
          // refetch so the thread list / messages cannot silently lag behind.
          if (this.everReady && this.needsResync) {
            this.needsResync = false;
            for (const listener of this.reconnectListeners) listener();
          }
          this.everReady = true;
        }
        if (msg.type === 'error' && (msg.code === 'AUTH_INVALID_TOKEN' || msg.code === 'AUTH_SESSION_REVOKED' || msg.code.startsWith('AUTH_'))) {
          this.ready = false;
          // Drop socket so reconnect path re-fetches a fresh token.
          try { ws.close(1008, 'auth retry'); } catch { /* ignore */ }
        }
        for (const listener of this.listeners) listener(msg);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = (event) => {
      if (this.ws === ws) this.ws = null;
      this.clearPingTimer();
      const wasReady = this.ready;
      this.ready = false;
      if (this.intentionalClose) return;
      // A newer tab took over this user's slot. Reconnecting would kick that tab
      // right back, so both tabs fight forever (measured: 6 tabs -> 20 auth calls,
      // 15 reconnect cycles and 20 DB writes in 10 seconds).
      if (event.code === CLOSE_SUPERSEDED) {
        this.superseded = true;
        // The tab was live and is now offline, so it must refetch when it returns.
        if (wasReady) this.needsResync = true;
        return;
      }
      if (wasReady) this.needsResync = true;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose will reconnect */
    };
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose || this.superseded || this.reconnectTimer != null) return;
    // Exponential backoff capped at 30s — never give up (mobile background kills WS).
    const delay = Math.min(30_000, 500 * (2 ** Math.min(this.attempt, 6)) + Math.random() * 400);
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private async authenticate(): Promise<void> {
    if (this.authInFlight || !this.tokenProvider) return;
    this.authInFlight = true;
    try {
      const accessToken = await this.tokenProvider();
      if (!accessToken || this.ws?.readyState !== WebSocket.OPEN) return;
      this.send({ type: 'auth', accessToken });
    } finally {
      this.authInFlight = false;
    }
  }

  private onVisibility = (): void => {
    if (document.hidden || this.intentionalClose) return;
    // The tab the user is actually looking at wins the realtime slot; the tab it
    // displaces goes quiet in the background instead of fighting back.
    this.superseded = false;
    if (!this.isReady()) {
      this.clearReconnectTimer();
      this.open();
    } else {
      this.send({ type: 'ping' });
    }
  };

  private onOnline = (): void => {
    if (this.intentionalClose) return;
    this.clearReconnectTimer();
    this.attempt = 0;
    this.open();
  };

  private onPageShow = (ev: PageTransitionEvent): void => {
    // bfcache restore after mobile Safari / Chrome tab freeze.
    if (ev.persisted) this.onVisibility();
  };

  private bindVisibility(): void {
    if (this.visibilityBound) return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('pageshow', this.onPageShow);
  }

  private unbindVisibility(): void {
    if (!this.visibilityBound) return;
    this.visibilityBound = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('pageshow', this.onPageShow);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer == null) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearPingTimer(): void {
    if (this.pingTimer == null) return;
    window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }
}

let singleton: RealtimeClient | null = null;

export function getRealtimeClient(): RealtimeClient {
  if (!singleton) singleton = new RealtimeClient();
  return singleton;
}
