import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

/**
 * In-memory replica of IdempotencyService semantics (UNIQUE key+route, payload hash).
 * Validates webhook replay / conflicting payload without a live DB.
 */

type RecordRow = {
  requestHash: string;
  responseCode: number | null;
  responseBody: unknown;
};

function hashPayload(payload: unknown): string {
  const json = JSON.stringify(payload ?? null, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return createHash('sha256').update(json).digest('hex');
}

class MemoryIdempotency {
  private readonly rows = new Map<string, RecordRow>();

  async run<T>(
    scope: string,
    key: string,
    payload: unknown,
    execute: () => Promise<T>,
    opts?: { userId?: string },
  ): Promise<{ kind: 'fresh' | 'replay'; value: T }> {
    const idKey = opts?.userId ? `${opts.userId}:${key}` : key;
    const mapKey = `${scope}|${idKey}`;
    const requestHash = hashPayload(payload);
    const existing = this.rows.get(mapKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new Error('idempotency conflict');
      }
      if (existing.responseCode === 200) {
        return { kind: 'replay', value: existing.responseBody as T };
      }
      if (existing.responseCode === null) {
        throw new Error('in progress');
      }
    }
    this.rows.set(mapKey, { requestHash, responseCode: null, responseBody: null });
    try {
      const value = await execute();
      this.rows.set(mapKey, { requestHash, responseCode: 200, responseBody: value });
      return { kind: 'fresh', value };
    } catch (err) {
      this.rows.set(mapKey, { requestHash, responseCode: 0, responseBody: null });
      throw err;
    }
  }
}

test('idempotency: duplicate webhook event returns replay, does not re-execute', async () => {
  const store = new MemoryIdempotency();
  let runs = 0;
  const exec = async () => {
    runs += 1;
    return { credited: true, paymentId: 'pi_1' };
  };
  const a = await store.run('payment.webhook.MANUAL', 'evt_1', { intentId: 'pi_1', status: 'SUCCEEDED' }, exec);
  const b = await store.run('payment.webhook.MANUAL', 'evt_1', { intentId: 'pi_1', status: 'SUCCEEDED' }, exec);
  assert.equal(a.kind, 'fresh');
  assert.equal(b.kind, 'replay');
  assert.equal(runs, 1);
  assert.deepEqual(a.value, b.value);
});

test('idempotency: conflicting payload rejected', async () => {
  const store = new MemoryIdempotency();
  await store.run('wallet.withdraw', 'k1', { amount: 100 }, async () => ({ ok: true }), { userId: '1' });
  await assert.rejects(
    () => store.run('wallet.withdraw', 'k1', { amount: 200 }, async () => ({ ok: true }), { userId: '1' }),
    /conflict/,
  );
});

test('idempotency: same key different users are isolated', async () => {
  const store = new MemoryIdempotency();
  let runs = 0;
  const exec = async () => {
    runs += 1;
    return { n: runs };
  };
  const a = await store.run('wallet.withdraw', 'same-key', { amount: 100 }, exec, { userId: '1' });
  const b = await store.run('wallet.withdraw', 'same-key', { amount: 100 }, exec, { userId: '2' });
  assert.equal(a.kind, 'fresh');
  assert.equal(b.kind, 'fresh');
  assert.equal(runs, 2);
});

test('idempotency: failed op can retry', async () => {
  const store = new MemoryIdempotency();
  let attempt = 0;
  await assert.rejects(
    () => store.run('payment.confirm', 'pi_x', { x: 1 }, async () => {
      attempt += 1;
      throw new Error('boom');
    }),
  );
  const ok = await store.run('payment.confirm', 'pi_x', { x: 1 }, async () => {
    attempt += 1;
    return { ok: true };
  });
  assert.equal(ok.kind, 'fresh');
  assert.equal(attempt, 2);
});
