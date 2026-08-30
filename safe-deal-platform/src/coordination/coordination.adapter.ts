export type CoordinationMessageHandler = (payload: string) => void;

export interface CoordinationAdapter {
  readonly kind: 'memory' | 'redis';
  connect(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  consumeFixedWindow(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterMs: number }>;
  publish(channel: string, payload: string): Promise<void>;
  subscribe(channel: string, handler: CoordinationMessageHandler): Promise<() => Promise<void>>;
}
