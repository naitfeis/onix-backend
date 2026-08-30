import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimeBus } from '../src/realtime/realtime-bus.service';
import { MemoryCoordinationAdapter } from '../src/coordination/memory-coordination.adapter';
import { SharedCoordinationService } from '../src/coordination/shared-coordination.service';

test('RealtimeBus fans out once and ignores its shared self-delivery', async () => {
  const coordination = new SharedCoordinationService(
    new MemoryCoordinationAdapter(),
    { backend: 'memory', instanceId: 'realtime-test' },
  );
  await coordination.onModuleInit();
  const bus = new RealtimeBus(coordination);
  await bus.onModuleInit();
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
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ['order.updated', 'notification']);
  off();
  bus.publish({
    kind: 'order.updated',
    orderId: '2',
    status: 'COMPLETED',
    recipientUserIds: [1n],
  });
  assert.deepEqual(seen, ['order.updated', 'notification']);
  await bus.onApplicationShutdown();
  await coordination.onApplicationShutdown();
});

test('RealtimeBus relays events to another instance without echo duplication', async () => {
  const adapter = new MemoryCoordinationAdapter();
  const coordinationOne = new SharedCoordinationService(adapter, { backend: 'memory', instanceId: 'one' });
  const coordinationTwo = new SharedCoordinationService(adapter, { backend: 'memory', instanceId: 'two' });
  const one = new RealtimeBus(coordinationOne);
  const two = new RealtimeBus(coordinationTwo);
  await one.onModuleInit();
  await two.onModuleInit();
  let localCount = 0;
  let remoteCount = 0;
  one.subscribe(() => { localCount += 1; });
  two.subscribe(() => { remoteCount += 1; });

  one.publish({
    kind: 'notification',
    userId: 7n,
    id: 'n2',
    title: 'shared',
    body: 'event',
    createdAt: new Date().toISOString(),
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(localCount, 1);
  assert.equal(remoteCount, 1);
  await one.onApplicationShutdown();
  await two.onApplicationShutdown();
});
