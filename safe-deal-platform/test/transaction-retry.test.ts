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

/**
 * The real shape Prisma produces when a serialization conflict is raised inside
 * `$queryRaw` (captured from a live PostgreSQL 18 run, not guessed). Before this
 * was covered, every `SELECT ... FOR UPDATE` conflict escaped the retry loop and
 * reached the user as a 500, because the SQL state lives in
 * `meta.driverAdapterError.cause.originalCode` — not in `code` or `meta.code`.
 */
function realP2010SerializationError(originalCode = '40001'): unknown {
  return Object.assign(
    new Error('Invalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `' + originalCode + '`.'),
    {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode,
            originalMessage: 'could not serialize access due to concurrent update',
            kind: 'TransactionWriteConflict',
          },
        },
      },
    },
  );
}

test('isRetryableTransactionConflict: real P2010 driver-adapter shapes are retryable', () => {
  assert.equal(isRetryableTransactionConflict(realP2010SerializationError('40001')), true);
  assert.equal(isRetryableTransactionConflict(realP2010SerializationError('40P01')), true);
  // Kind alone is enough — a driver could rename the state field.
  assert.equal(
    isRetryableTransactionConflict({ meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } } }),
    true,
  );
});

test('isRetryableTransactionConflict: P2010 without a write conflict is NOT retryable', () => {
  // P2010 is also raised for syntax errors and constraint problems; retrying those
  // would hide a bug and burn three attempts.
  assert.equal(
    isRetryableTransactionConflict({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '23505', kind: 'UniqueConstraint' } } },
    }),
    false,
  );
  assert.equal(isRetryableTransactionConflict({ code: 'P2010', meta: {} }), false);
  assert.equal(isRetryableTransactionConflict({ code: 'P2010' }), false);
});

test('isRetryableTransactionConflict: does not hang on a cyclic error chain', () => {
  const a: Record<string, unknown> = { code: 'P2010' };
  const b: Record<string, unknown> = { cause: a };
  a.cause = b;
  assert.equal(isRetryableTransactionConflict(a), false);
});

test('withSerializableTransaction retries the real P2010 shape then succeeds', async () => {
  let attempts = 0;
  const prisma = {
    $transaction: async (execute: (tx: unknown) => Promise<string>) => {
      attempts += 1;
      if (attempts < 3) throw realP2010SerializationError();
      return execute({});
    },
  };
  const result = await withSerializableTransaction(prisma, async () => 'ok', 5);
  assert.equal(result, 'ok');
  assert.equal(attempts, 3, 'conflict inside $queryRaw is retried, not surfaced as a 500');
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
