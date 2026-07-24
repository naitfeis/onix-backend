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
  | { type: 'presence'; userId: string; onixId: string; online: boolean; lastOnline: string }
  | { type: 'notification'; id: string; title: string; body: string; createdAt: string; data?: Record<string, unknown> }
  | { type: 'order.updated'; orderId: string; status: string; chatId?: string };

type Listener = (msg: RealtimeInbound) => void;

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
  private accessToken: string | null = null;
  private subscribedChats = new Set<string>();

  connect(accessToken: string): void {
    this.accessToken = accessToken;
    this.intentionalClose = false;
    this.open();
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer);
    if (this.pingTimer != null) window.clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.ws?.close(1000, 'client disconnect');
    this.ws = null;
  }

  updateToken(accessToken: string): void {
    this.accessToken = accessToken;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'auth', accessToken });
    }
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

  private open(): void {
    if (this.intentionalClose || !this.accessToken) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const ws = new WebSocket(realtimeUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.send({ type: 'auth', accessToken: this.accessToken! });
      if (this.pingTimer != null) window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), 20_000);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as RealtimeInbound;
        if (msg.type === 'ready') {
          for (const chatId of this.subscribedChats) {
            this.send({ type: 'subscribe_chat', chatId });
          }
        }
        for (const listener of this.listeners) listener(msg);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (this.pingTimer != null) window.clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      if (this.intentionalClose) return;
      const delay = Math.min(30_000, 500 * (2 ** this.attempt) + Math.random() * 300);
      this.attempt += 1;
      this.reconnectTimer = window.setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => {
      /* onclose will reconnect */
    };
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
