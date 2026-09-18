import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { RedisCoordinationAdapter } from '../src/coordination/redis-coordination.adapter';
import { SharedCoordinationService } from '../src/coordination/shared-coordination.service';
import { RealtimeBus } from '../src/realtime/realtime-bus.service';

const redisTestUrl = process.env.REDIS_TEST_URL?.trim();

test('Redis realtime pub/sub crosses instances without source echo', {
  skip: redisTestUrl ? false : 'set REDIS_TEST_URL to an isolated non-production Redis instance',
  timeout: 15_000,
}, async () => {
  const url = requireRedisTestUrl(redisTestUrl);
  const runId = randomUUID();
  const coordinationA = new SharedCoordinationService(
    new RedisCoordinationAdapter(url),
    { backend: 'redis', redisUrl: url, instanceId: `redis-test-a-${runId}` },
  );
  const coordinationB = new SharedCoordinationService(
    new RedisCoordinationAdapter(url),
    { backend: 'redis', redisUrl: url, instanceId: `redis-test-b-${runId}` },
  );
  const busA = new RealtimeBus(coordinationA);
  const busB = new RealtimeBus(coordinationB);

  try {
    await Promise.all([coordinationA.onModuleInit(), coordinationB.onModuleInit()]);
    await Promise.all([busA.onModuleInit(), busB.onModuleInit()]);

    let sourceDeliveries = 0;
    let remoteDeliveries = 0;
    const offA = busA.subscribe((event) => {
      if (event.kind === 'notification' && event.id === runId) sourceDeliveries += 1;
    });
    const offB = busB.subscribe((event) => {
      if (event.kind === 'notification' && event.id === runId) remoteDeliveries += 1;
    });

    busA.publish({
      kind: 'notification',
      userId: 7n,
      id: runId,
      title: 'Redis integration probe',
      body: 'cross-instance delivery',
      createdAt: new Date().toISOString(),
    });

    await waitFor(() => remoteDeliveries === 1);
    await delay(150);
    assert.equal(sourceDeliveries, 1, 'instance A must receive only its immediate local delivery');
    assert.equal(remoteDeliveries, 1, 'instance B must receive exactly one Redis delivery');
    offA();
    offB();
  } finally {
    await Promise.allSettled([busA.onApplicationShutdown(), busB.onApplicationShutdown()]);
    await Promise.allSettled([
      coordinationA.onApplicationShutdown(),
      coordinationB.onApplicationShutdown(),
    ]);
  }
});

function requireRedisTestUrl(value: string | undefined): string {
  assert.ok(value, 'REDIS_TEST_URL is required');
  const parsed = new URL(value);
  assert.ok(
    parsed.protocol === 'redis:' || parsed.protocol === 'rediss:',
    'REDIS_TEST_URL must use redis:// or rediss://',
  );
  return value;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for cross-instance Redis delivery`);
    }
    await delay(25);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
