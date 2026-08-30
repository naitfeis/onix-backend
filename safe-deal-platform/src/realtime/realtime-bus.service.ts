import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { structuredLog } from '../observability/structured-logger';
import {
  decodeJson,
  encodeJson,
  SharedCoordinationService,
} from '../coordination/shared-coordination.service';
import type { RealtimeBusEvent } from './realtime.types';

@Injectable()
export class RealtimeBus implements OnModuleInit, OnApplicationShutdown {
  private readonly ee = new EventEmitter();
  private unsubscribeShared?: () => Promise<void>;

  constructor(private readonly coordination: SharedCoordinationService) {
    this.ee.setMaxListeners(50);
  }

  async onModuleInit(): Promise<void> {
    this.unsubscribeShared = await this.coordination.subscribe('realtime', (payload) => {
      try {
        const envelope = decodeJson<{ source: string; event: RealtimeBusEvent }>(payload);
        if (envelope.source !== this.coordination.config.instanceId) {
          this.ee.emit('event', envelope.event);
        }
      } catch (error) {
        structuredLog.error('Invalid shared realtime event', {}, error);
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.unsubscribeShared?.();
  }

  publish(event: RealtimeBusEvent): void {
    const listeners = this.ee.listenerCount('event');
    if (listeners === 0) {
      structuredLog.warn('realtime bus publish with zero subscribers', { kind: event.kind });
    }
    this.ee.emit('event', event);
    void this.coordination.publish('realtime', encodeJson({
      source: this.coordination.config.instanceId,
      event,
    })).catch((error: unknown) => {
      structuredLog.error('Shared realtime publish failed', { kind: event.kind }, error);
    });
  }

  subscribe(handler: (event: RealtimeBusEvent) => void): () => void {
    this.ee.on('event', handler);
    return () => this.ee.off('event', handler);
  }
}
