import { EventEmitter } from 'node:events';
import type { CoordinationAdapter, CoordinationMessageHandler } from './coordination.adapter';

type Entry = { value: string; expiresAt: number };

export class MemoryCoordinationAdapter implements CoordinationAdapter {
  readonly kind = 'memory' as const;
  private readonly entries = new Map<string, Entry>();
  private readonly bus = new EventEmitter();

  constructor(private readonly maxEntries = 10_000) {
    this.bus.setMaxListeners(100);
  }

  async connect(): Promise<void> {}
  async close(): Promise<void> {
    this.entries.clear();
    this.bus.removeAllListeners();
  }
  async ping(): Promise<boolean> {
    return true;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.prune();
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async consumeFixedWindow(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const now = Date.now();
    const existing = this.entries.get(key);
    const count = existing && existing.expiresAt > now ? Number(existing.value) + 1 : 1;
    const expiresAt = existing && existing.expiresAt > now ? existing.expiresAt : now + windowMs;
    await this.set(key, String(count), Math.max(1, expiresAt - now));
    return { allowed: count <= limit, retryAfterMs: Math.max(1, expiresAt - now) };
  }

  async publish(channel: string, payload: string): Promise<void> {
    this.bus.emit(channel, payload);
  }

  async subscribe(channel: string, handler: CoordinationMessageHandler): Promise<() => Promise<void>> {
    this.bus.on(channel, handler);
    return async () => {
      this.bus.off(channel, handler);
    };
  }

  size(): number {
    this.prune();
    return this.entries.size;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
