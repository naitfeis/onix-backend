import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { hashPhone, maskPhone, normalizePhone, phoneRequiredToSell, samePhoneHash } from '../src/phone-hash';
import { PhoneCaptureService } from '../src/login-challenge/phone-capture.service';

const SECRET = 'unit-test-phone-secret';

function withSecret(run: () => Promise<void> | void) {
  const prev = process.env.PHONE_HASH_SECRET;
  const prevRequired = process.env.SELLER_PHONE_REQUIRED;
  process.env.PHONE_HASH_SECRET = SECRET;
  process.env.SELLER_PHONE_REQUIRED = 'true';
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (prev === undefined) delete process.env.PHONE_HASH_SECRET;
      else process.env.PHONE_HASH_SECRET = prev;
      if (prevRequired === undefined) delete process.env.SELLER_PHONE_REQUIRED;
      else process.env.SELLER_PHONE_REQUIRED = prevRequired;
    });
}

function expectedHash(normalized: string): string {
  return createHmac('sha256', SECRET).update(normalized).digest('hex').slice(0, 64);
}

test('normalizePhone: E.164 forms and Russian domestic 8XXXXXXXXXX', () => withSecret(() => {
  assert.equal(normalizePhone('+7 916 123-45-67'), '+79161234567');
  assert.equal(normalizePhone('8 (916) 123-45-67'), '+79161234567');
  assert.equal(normalizePhone('9161234567'), '+79161234567');
  assert.equal(normalizePhone('0044 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('123'), null, 'too short to be a real number');
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
  // Telegram can hand back a number without the leading +.
  assert.equal(normalizePhone('79161234567'), '+79161234567');
}));

test('hashPhone is keyed and stable across equivalent forms', () => withSecret(() => {
  const a = hashPhone('+79161234567');
  assert.equal(a, expectedHash('+79161234567'), 'matches the documented HMAC scheme');
  assert.equal(hashPhone('89161234567'), a, 'equivalent forms produce the same hash');
  assert.notEqual(hashPhone('+79161234568'), a, 'a different number hashes differently');
}));

test('samePhoneHash is length-safe and null-safe', () => withSecret(() => {
  const h = hashPhone('+79161234567')!;
  assert.equal(samePhoneHash(h, h), true);
  assert.equal(samePhoneHash(h, 'abc'), false);
  assert.equal(samePhoneHash(null, h), false);
  assert.equal(samePhoneHash(h, undefined), false);
}));

test('maskPhone never leaks the number', () => withSecret(() => {
  assert.equal(maskPhone('+79161234567'), '+*********67', 'all but the last two digits masked');
  assert.equal(maskPhone('+123'), '***', 'too short to reveal anything');
  assert.ok(!maskPhone('+79161234567').includes('91612345'), 'no middle digits');
}));

test('phoneRequiredToSell defaults on and honours an explicit opt-out', () => {
  const prev = process.env.SELLER_PHONE_REQUIRED;
  delete process.env.SELLER_PHONE_REQUIRED;
  assert.equal(phoneRequiredToSell(), true, 'escrow sellers must be identifiable by default');
  process.env.SELLER_PHONE_REQUIRED = 'false';
  assert.equal(phoneRequiredToSell(), false);
  if (prev === undefined) delete process.env.SELLER_PHONE_REQUIRED;
  else process.env.SELLER_PHONE_REQUIRED = prev;
});

function fakePrisma(state: {
  user: { id: bigint; phoneHash: string | null } | null;
  conflict?: { id: bigint; onixId: string; bannedAt: Date | null; deletedAt: Date | null; securityLockedAt: Date | null };
}) {
  const writes: Array<{ phoneHash?: string | null; phoneSharedAt?: Date }> = [];
  const markers: string[] = [];
  const db = {
    user: {
      findUnique: async () => (state.user ? { id: state.user.id, phoneHash: state.user.phoneHash } : null),
      findFirst: async () => state.conflict ?? null,
      update: async (args: { data: { phoneHash?: string | null; phoneSharedAt?: Date } }) => {
        writes.push(args.data);
        return state.user;
      },
    },
    abuseMarker: {
      upsert: async (args: { create: { valueHash: string } }) => { markers.push(args.create.valueHash); return {}; },
    },
    securityEvent: { create: async () => ({}) },
  };
  return { db: db as never, writes, markers };
}

function noRisk() {
  return { recordBanMarkers: async () => undefined } as never;
}

test('capture stores only the hash, never the raw number', async () => {
  await withSecret(async () => {
    const { db, writes, markers } = fakePrisma({ user: { id: 7n, phoneHash: null } });
    const service = new PhoneCaptureService(db, noRisk(), { applyLock: async () => ({ locked: true }) } as never);
    const result = await service.capture(7n, '+7 916 123-45-67');
    assert.equal(result.kind, 'saved');
    assert.equal(writes.length, 1, 'exactly one user update');
    assert.equal(writes[0]!.phoneHash, expectedHash('+79161234567'));
    assert.ok(JSON.stringify(writes).indexOf('9161234567') === -1, 'raw digits must never be persisted');
    assert.deepEqual(markers, [expectedHash('+79161234567')], 'PHONE_HASH marker is written for future signups');
    // 11 digits → '+' plus nine stars plus the last two digits.
    assert.equal((result as { phoneMasked: string }).phoneMasked, '+*********67');
  });
});

test('capture refuses a phone already bound to a punished account', async () => {
  await withSecret(async () => {
    const { db, writes } = fakePrisma({
      user: { id: 7n, phoneHash: null },
      conflict: { id: 9n, onixId: 'ONIX-000009', bannedAt: new Date(), deletedAt: null, securityLockedAt: null },
    });
    const locks: bigint[] = [];
    const service = new PhoneCaptureService(db, noRisk(), {
      applyLock: async (input: { userId: bigint }) => { locks.push(input.userId); return { locked: true }; },
    } as never);
    const result = await service.capture(7n, '+79161234567');
    assert.equal(result.kind, 'conflict', 'a banned seller cannot rebuild on the same phone');
    assert.equal(writes.length, 0, 'the phone is never attached to the new account');
    assert.deepEqual(locks, [7n], 'the reusing account is locked, not the old one');
  });
});

test('capture is idempotent: resharing the same number keeps the first timestamp', async () => {
  await withSecret(async () => {
    const stored = expectedHash('+79161234567');
    const { db, writes } = fakePrisma({ user: { id: 7n, phoneHash: stored } });
    const service = new PhoneCaptureService(db, noRisk(), { applyLock: async () => ({ locked: true }) } as never);
    const first = await service.capture(7n, '+79161234567');
    assert.equal(first.kind, 'saved');
    assert.equal((first as { alreadyVerified: boolean }).alreadyVerified, true);
    assert.equal(writes.length, 0, 'no rewrite — the original verification time stays as evidence');
  });
});

test('capture rejects an unusable number without writing anything', async () => {
  await withSecret(async () => {
    const { db, writes } = fakePrisma({ user: { id: 7n, phoneHash: null } });
    const service = new PhoneCaptureService(db, noRisk(), { applyLock: async () => ({ locked: true }) } as never);
    assert.equal((await service.capture(7n, 'nope')).kind, 'invalid');
    assert.equal((await service.capture(7n, null)).kind, 'invalid');
    assert.equal(writes.length, 0);
  });
});

test('capture is a no-op when seller phone verification is disabled', async () => {
  await withSecret(async () => {
    process.env.SELLER_PHONE_REQUIRED = 'false';
    const { db, writes } = fakePrisma({ user: { id: 7n, phoneHash: null } });
    const service = new PhoneCaptureService(db, noRisk(), { applyLock: async () => ({ locked: true }) } as never);
    assert.equal((await service.capture(7n, '+79161234567')).kind, 'disabled');
    assert.equal(writes.length, 0, 'nothing is stored while the feature is off');
  });
});