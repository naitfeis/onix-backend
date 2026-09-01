import assert from 'node:assert/strict';
import test from 'node:test';
import { isRetryableTransactionConflict, withSerializableTransaction } from '../src/database/transaction-retry';

test('isRetryableTransactionConflict: Prisma P2034 and PG 40001/40P01', () => {
  assert.equal(isRetryableTransactionConflict({ code: 'P2034' }), true);
  assert.equal(isRetryableTransactionConflict({ code: '40001' }), true);
  assert.equal(isRetryableTransactionConflict({ code: '40P01' }), true);
  assert.equal(isRetryableTransactionConflict({ meta: { code: '40001' } }), true);
  assert.equal(isRetryableTransactionConflict({ cause: { code: '40P01' } }), true);
  assert.equal(isRetryableTransactionConflict({ code: 'P2002' }), false);
  assert.equal(isRetryableTransactionConflict(new Error('nope')), false);
});

test('withSerializableTransaction retries P2034 then succeeds', async () => {
  let attempts = 0;
  const prisma = {
    $transaction: async (execute: (tx: unknown) => Promise<string>) => {
      attempts += 1;
      if (attempts < 3) {
        const err = Object.assign(new Error('write conflict'), { code: 'P2034' });
        throw err;
      }
      return execute({});
    },
  };
  const result = await withSerializableTransaction(prisma, async () => 'ok', 5);
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('withSerializableTransaction does not retry business errors', async () => {
  let attempts = 0;
  const prisma = {
    $transaction: async () => {
      attempts += 1;
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    },
  };
  await assert.rejects(
    () => withSerializableTransaction(prisma, async () => 'nope'),
    (err: unknown) => Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'P2002'),
  );
  assert.equal(attempts, 1);
});

test('withSerializableTransaction exhausts deadlock retries', async () => {
  let attempts = 0;
  const prisma = {
    $transaction: async () => {
      attempts += 1;
      throw Object.assign(new Error('deadlock'), { code: '40P01' });
    },
  };
  await assert.rejects(() => withSerializableTransaction(prisma, async () => 'nope', 3));
  assert.equal(attempts, 3);
});
