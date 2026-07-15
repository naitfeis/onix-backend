export type AuthBroadcastEvent =
  | { type: 'logout' }
  | { type: 'force-reauth'; reason?: string }
  | { type: 'token-updated'; accessToken: string; expiresAtMs: number };

export type AuthBroadcastHandler = (event: AuthBroadcastEvent) => void;

const CHANNEL_NAME = 'onix-website-auth';

export type AuthChannelPort = {
  postMessage(data: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
};

/**
 * Cross-tab auth sync via BroadcastChannel (same origin).
 * Peers update memory from `token-updated` without a second refresh
 * (avoids refresh-family reuse across tabs).
 */
export class AuthBroadcast {
  private channel: AuthChannelPort | null = null;
  private readonly handlers = new Set<AuthBroadcastHandler>();
  private readonly onMessage: (event: MessageEvent) => void;

  constructor(
    channelName: string = CHANNEL_NAME,
    factory?: (name: string) => AuthChannelPort | null,
  ) {
    this.onMessage = (event: MessageEvent) => {
      const data = event.data as AuthBroadcastEvent | undefined;
      if (!data || typeof data !== 'object' || !('type' in data)) return;
      for (const handler of this.handlers) handler(data);
    };

    try {
      if (factory) {
        this.channel = factory(channelName);
      } else if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel(channelName);
      }
      this.channel?.addEventListener('message', this.onMessage);
    } catch {
      this.channel = null;
    }
  }

  subscribe(handler: AuthBroadcastHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  publish(event: AuthBroadcastEvent): void {
    try {
      this.channel?.postMessage(event);
    } catch {
      /* Channel closed or unsupported. */
    }
  }

  close(): void {
    this.channel?.removeEventListener('message', this.onMessage);
    try { this.channel?.close(); } catch { /* ignore */ }
    this.channel = null;
    this.handlers.clear();
  }
}

type MemoryTab = AuthChannelPort & {
  deliver(message: MessageEvent): void;
};

/** In-memory bus for unit tests (simulates N tabs on one origin). */
export class MemoryAuthBroadcastBus {
  private readonly tabs = new Map<string, Set<MemoryTab>>();

  create(name: string): AuthChannelPort {
    const listeners = new Set<(event: MessageEvent) => void>();
    const bus = this;

    const channel: MemoryTab = {
      postMessage(data: unknown) {
        const peers = bus.tabs.get(name);
        if (!peers) return;
        const message = { data } as MessageEvent;
        for (const peer of peers) {
          if (peer === channel) continue;
          peer.deliver(message);
        }
      },
      addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
        listeners.add(listener);
      },
      removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
        listeners.delete(listener);
      },
      close() {
        listeners.clear();
        bus.tabs.get(name)?.delete(channel);
      },
      deliver(message: MessageEvent) {
        for (const listener of [...listeners]) listener(message);
      },
    };

    if (!this.tabs.has(name)) this.tabs.set(name, new Set());
    this.tabs.get(name)!.add(channel);
    return channel;
  }
}
