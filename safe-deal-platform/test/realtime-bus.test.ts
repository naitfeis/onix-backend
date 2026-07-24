import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimeBus } from '../src/realtime/realtime-bus.service';

test('RealtimeBus fans out published events to subscribers', () => {
  const bus = new RealtimeBus();
  const seen: string[] = [];
  const off = bus.subscribe((event) => {
    seen.push(event.kind);
  });
  bus.publish({
    kind: 'order.updated',
    orderId: '1',
    status: 'DELIVERING',
    recipientUserIds: [1n, 2n],
  });
  bus.publish({
    kind: 'notification',
    userId: 1n,
    id: 'n1',
    title: 't',
    body: 'b',
    createdAt: new Date().toISOString(),
  });
  assert.deepEqual(seen, ['order.updated', 'notification']);
  off();
  bus.publish({
    kind: 'order.updated',
    orderId: '2',
    status: 'COMPLETED',
    recipientUserIds: [1n],
  });
  assert.deepEqual(seen, ['order.updated', 'notification']);
});
