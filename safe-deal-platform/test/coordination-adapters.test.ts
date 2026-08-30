import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpException } from '@nestjs/common';
import { resolveCoordinationConfig } from '../src/coordination/coordination.config';
import { MemoryCoordinationAdapter } from '../src/coordination/memory-coordination.adapter';
import {
  SharedCoordinationService,
} from '../src/coordination/shared-coordination.service';
import { DistributedRateLimiter } from '../src/rate-limit';

test('scale gates reject production and scale-out without Redis', () => {
  assert.throws(
    () => resolveCoordinationConfig({ NODE_ENV: 'production', WEB_CONCURRENCY: '1' }),
    /Redis coordination is required/,
  );
  assert.throws(
    () => resolveCoordinationConfig({ NODE_ENV: 'test', WEB_CONCURRENCY: '2' }),
    /Redis coordination is required/,
  );
  assert.equal(
    resolveCoordinationConfig({ NODE_ENV: 'test', WEB_CONCURRENCY: '1' }).backend,
    'memory',
  );
  assert.equal(
    resolveCoordinationConfig({
      NODE_ENV: 'test',
      COORDINATION_BACKEND: 'memory',
      REDIS_URL: 'redis://not-used',
    }).backend,
    'memory',
  );
});

test('memory adapter is bounded and expires values', async () => {
  const adapter = new MemoryCoordinationAdapter(2);
  await adapter.set('a', '1', 10_000);
  await adapter.set('b', '2', 10_000);
  await adapter.set('c', '3', 10_000);
  assert.equal(adapter.size(), 2);
  assert.equal(await adapter.get('a'), null);
  await adapter.set('short', 'x', 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await adapter.get('short'), null);
});

test('distributed limiter shares a window through the adapter', async () => {
  const adapter = new MemoryCoordinationAdapter();
  const first = new DistributedRateLimiter(new SharedCoordinationService(
    adapter,
    { backend: 'memory', instanceId: 'one' },
  ));
  const second = new DistributedRateLimiter(new SharedCoordinationService(
    adapter,
    { backend: 'memory', instanceId: 'two' },
  ));
  await first.assert('login:ip', 2, 60_000);
  await second.assert('login:ip', 2, 60_000);
  await assert.rejects(
    () => first.assert('login:ip', 2, 60_000),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
  );
});

test('shared JSON preserves Date, bigint, and Map values', async () => {
  const coordination = new SharedCoordinationService(
    new MemoryCoordinationAdapter(),
    { backend: 'memory', instanceId: 'codec' },
  );
  await coordination.setJson('shape', {
    at: new Date('2026-01-01T00:00:00.000Z'),
    id: 7n,
    map: new Map([['7', { ok: true }]]),
  }, 60_000);
  const value = await coordination.getJson<{
    at: Date;
    id: bigint;
    map: Map<string, { ok: boolean }>;
  }>('shape');
  assert.ok(value?.at instanceof Date);
  assert.equal(value?.id, 7n);
  assert.equal(value?.map.get('7')?.ok, true);
});
