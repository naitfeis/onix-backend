import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { structuredLog } from '../observability/structured-logger';
import type { RealtimeBusEvent } from './realtime.types';

/**
 * In-process pub/sub for realtime fan-out (single Nest API process).
 * Scale-out gate: replace with Redis when WEB_CONCURRENCY > 1.
 */
@Injectable()
export class RealtimeBus {
  private readonly ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(50);
  }

  publish(event: RealtimeBusEvent): void {
    const listeners = this.ee.listenerCount('event');
    if (listeners === 0) {
      structuredLog.warn('realtime bus publish with zero subscribers', { kind: event.kind });
    }
    this.ee.emit('event', event);
  }

  subscribe(handler: (event: RealtimeBusEvent) => void): () => void {
    this.ee.on('event', handler);
    return () => this.ee.off('event', handler);
  }
}
