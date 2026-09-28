import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthPlatformError } from '../src/auth-v2/auth-errors';
import { MFA_PURPOSE_WITHDRAW, mfaDeepLinks, mfaChallengeTtlMs } from '../src/mfa/mfa.types';
import { MfaStepUpService } from '../src/mfa/mfa-step-up.service';

test('mfaDeepLinks include bot start payload', () => {
  const links = mfaDeepLinks('cltestchallenge01');
  assert.match(links.webDeepLink, /start=mfa_cltestchallenge01/);
  assert.match(links.deepLink, /start=mfa_cltestchallenge01/);
});

test('mfaChallengeTtlMs clamps to sane range', () => {
  const prev = process.env.MFA_CHALLENGE_TTL_MS;
  process.env.MFA_CHALLENGE_TTL_MS = '1000';
  assert.equal(mfaChallengeTtlMs(), 600_000);
  process.env.MFA_CHALLENGE_TTL_MS = '120000';
  assert.equal(mfaChallengeTtlMs(), 120_000);
  if (prev === undefined) delete process.env.MFA_CHALLENGE_TTL_MS;
  else process.env.MFA_CHALLENGE_TTL_MS = prev;
});

test('consumeConfirmed requires CONFIRMED status', async () => {
  const prisma = {
    mfaChallenge: {
      findUnique: async () => ({
        id: 'ch1',
        userId: 1n,
        purpose: MFA_PURPOSE_WITHDRAW,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
        sessionId: null,
      }),
      update: async () => ({}),
    },
  };
  const mfa = new MfaStepUpService(prisma as never);
  await assert.rejects(
    () => mfa.consumeConfirmed({ challengeId: 'ch1', userId: 1n }),
    (err: unknown) => err instanceof AuthPlatformError && err.code === 'AUTH_LOGIN_CHALLENGE_PENDING',
  );
});

test('consumeConfirmed claims CONFIRMED atomically', async () => {
  const claims: Array<{ where: unknown; data: unknown }> = [];
  const prisma = {
    mfaChallenge: {
      findUnique: async () => ({
        id: 'ch1',
        userId: 1n,
        purpose: MFA_PURPOSE_WITHDRAW,
        status: 'CONFIRMED',
        expiresAt: new Date(Date.now() + 60_000),
        sessionId: 'sess',
      }),
      updateMany: async ({ where, data }: { where: unknown; data: unknown }) => {
        claims.push({ where, data });
        return { count: 1 };
      },
    },
  };
  const mfa = new MfaStepUpService(prisma as never);
  await mfa.consumeConfirmed({ challengeId: 'ch1', userId: 1n, sessionId: 'sess' });
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0]!.data, { status: 'CONSUMED' });
  // The status guard must live in the WHERE clause, not in a prior read.
  assert.deepEqual((claims[0]!.where as { status: string }).status, 'CONFIRMED');
});

test('consumeConfirmed cannot be replayed by a concurrent second withdraw', async () => {
  // Regression: the old read-then-write pair let two withdraws presenting the
  // same challengeId both pass step-up, because neither saw the other's write
  // (this runs outside the money transaction, so no advisory lock is held yet).
  let rowStatus = 'CONFIRMED';
  const prisma = {
    mfaChallenge: {
      findUnique: async () => ({
        id: 'ch1',
        userId: 1n,
        purpose: MFA_PURPOSE_WITHDRAW,
        status: rowStatus,
        expiresAt: new Date(Date.now() + 60_000),
        sessionId: 'sess',
      }),
      updateMany: async ({ where }: { where: { status: string } }) => {
        if (rowStatus !== where.status) return { count: 0 };
        rowStatus = 'CONSUMED';
        return { count: 1 };
      },
    },
  };
  const mfa = new MfaStepUpService(prisma as never);
  const call = () => mfa.consumeConfirmed({ challengeId: 'ch1', userId: 1n, sessionId: 'sess' });
  const settled = await Promise.allSettled([call(), call(), call()]);
  const passed = settled.filter((row) => row.status === 'fulfilled').length;
  assert.equal(passed, 1, 'exactly one withdraw may spend a step-up challenge');
  const rejected = settled.filter((row) => row.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(rejected.length, 2);
  for (const row of rejected) {
    assert.equal((row.reason as AuthPlatformError).code, 'AUTH_LOGIN_CHALLENGE_CONSUMED');
  }
});

test('confirmFromBot rejects foreign telegramId', async () => {
  const prisma = {
    mfaChallenge: {
      findUnique: async () => ({
        id: 'ch1',
        userId: 1n,
        purpose: MFA_PURPOSE_WITHDRAW,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
        sessionId: null,
      }),
    },
    user: {
      findUnique: async () => ({ telegramId: 99n }),
    },
  };
  const mfa = new MfaStepUpService(prisma as never);
  await assert.rejects(
    () => mfa.confirmFromBot('ch1', 42n),
    (err: unknown) => err instanceof AuthPlatformError && err.code === 'AUTH_PROVIDER_REJECTED',
  );
});
