import { createClient } from 'redis';
import type { CoordinationAdapter, CoordinationMessageHandler } from './coordination.adapter';

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

export class RedisCoordinationAdapter implements CoordinationAdapter {
  readonly kind = 'redis' as const;
  private readonly client;
  private readonly subscriber;

  constructor(url: string, onError: (error: Error) => void = () => undefined) {
    this.client = createClient({
      url,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: (retries) => (retries >= 10 ? false : Math.min(100 * (retries + 1), 1_000)),
      },
    });
    this.subscriber = this.client.duplicate();
    this.client.on('error', onError);
    this.subscriber.on('error', onError);
  }

  async connect(): Promise<void> {
    await Promise.all([this.client.connect(), this.subscriber.connect()]);
    await this.client.ping();
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      this.client.isOpen ? this.client.quit() : Promise.resolve(),
      this.subscriber.isOpen ? this.subscriber.quit() : Promise.resolve(),
    ]);
  }

  async ping(): Promise<boolean> {
    if (!this.client.isReady || !this.subscriber.isReady) return false;
    return (await this.client.ping()) === 'PONG';
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.client.set(key, value, { PX: ttlMs });
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async consumeFixedWindow(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const result = await this.client.eval(FIXED_WINDOW_SCRIPT, {
      keys: [key],
      arguments: [String(windowMs)],
    }) as [number, number];
    const [count, ttl] = result.map(Number) as [number, number];
    return { allowed: count <= limit, retryAfterMs: Math.max(1, ttl) };
  }

  async publish(channel: string, payload: string): Promise<void> {
    await this.client.publish(channel, payload);
  }

  async subscribe(channel: string, handler: CoordinationMessageHandler): Promise<() => Promise<void>> {
    await this.subscriber.subscribe(channel, handler);
    return async () => {
      await this.subscriber.unsubscribe(channel, handler);
    };
  }
}
