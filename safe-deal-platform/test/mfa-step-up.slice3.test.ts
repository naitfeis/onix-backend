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

test('consumeConfirmed marks CONSUMED', async () => {
  const updates: unknown[] = [];
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
      update: async ({ data }: { data: unknown }) => {
        updates.push(data);
        return {};
      },
    },
  };
  const mfa = new MfaStepUpService(prisma as never);
  await mfa.consumeConfirmed({ challengeId: 'ch1', userId: 1n, sessionId: 'sess' });
  assert.deepEqual(updates[0], { status: 'CONSUMED' });
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
