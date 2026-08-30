import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { structuredLog } from '../observability/structured-logger';
import type { CoordinationAdapter } from './coordination.adapter';
import type { CoordinationConfig } from './coordination.config';

export const COORDINATION_ADAPTER = Symbol('COORDINATION_ADAPTER');
export const COORDINATION_CONFIG = Symbol('COORDINATION_CONFIG');

@Injectable()
export class SharedCoordinationService implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(COORDINATION_ADAPTER) private readonly adapter: CoordinationAdapter,
    @Inject(COORDINATION_CONFIG) readonly config: CoordinationConfig,
  ) {}

  get backend(): 'memory' | 'redis' {
    return this.adapter.kind;
  }

  async onModuleInit(): Promise<void> {
    await this.adapter.connect();
    structuredLog.info('Shared coordination ready', { backend: this.adapter.kind });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.adapter.close();
  }

  async isHealthy(): Promise<boolean> {
    try {
      return await this.adapter.ping();
    } catch {
      return false;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.adapter.get(this.key(key));
    return value === null ? null : decodeJson<T>(value);
  }

  async setJson(key: string, value: unknown, ttlMs: number): Promise<void> {
    await this.adapter.set(this.key(key), encodeJson(value), ttlMs);
  }

  async delete(key: string): Promise<void> {
    await this.adapter.delete(this.key(key));
  }

  consumeFixedWindow(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfterMs: number }> {
    return this.adapter.consumeFixedWindow(this.key(`rate:${key}`), limit, windowMs);
  }

  publish(channel: string, payload: string): Promise<void> {
    return this.adapter.publish(this.key(`channel:${channel}`), payload);
  }

  subscribe(channel: string, handler: (payload: string) => void): Promise<() => Promise<void>> {
    return this.adapter.subscribe(this.key(`channel:${channel}`), handler);
  }

  private key(value: string): string {
    return `onix:v1:${value}`;
  }
}

export function encodeJson(value: unknown): string {
  return JSON.stringify(toJsonValue(value));
}

export function decodeJson<T>(value: string): T {
  return JSON.parse(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object') return item;
    const tagged = item as { $onixType?: string; value?: unknown };
    if (tagged.$onixType === 'bigint' && typeof tagged.value === 'string') return BigInt(tagged.value);
    if (tagged.$onixType === 'date' && typeof tagged.value === 'string') return new Date(tagged.value);
    if (tagged.$onixType === 'map' && Array.isArray(tagged.value)) return new Map(tagged.value as [unknown, unknown][]);
    return item;
  }) as T;
}

function toJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return { $onixType: 'bigint', value: value.toString() };
  if (value instanceof Date) return { $onixType: 'date', value: value.toISOString() };
  if (value instanceof Map) {
    return { $onixType: 'map', value: [...value.entries()].map(([key, item]) => [key, toJsonValue(item)]) };
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonValue(item)]),
    );
  }
  return value;
}
