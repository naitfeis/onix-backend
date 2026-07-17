import assert from 'node:assert/strict';
import test from 'node:test';
import { depositHoldDays } from '../src/economy/wallet/deposit.service';
import { buildPublicTrustCard } from '../src/economy/trust/trust-card';

test('depositHoldDays defaults to 10 and clamps invalid env', () => {
  const prev = process.env.DEPOSIT_HOLD_DAYS;
  delete process.env.DEPOSIT_HOLD_DAYS;
  assert.equal(depositHoldDays(), 10);
  process.env.DEPOSIT_HOLD_DAYS = '0';
  assert.equal(depositHoldDays(), 10);
  process.env.DEPOSIT_HOLD_DAYS = '14';
  assert.equal(depositHoldDays(), 14);
  process.env.DEPOSIT_HOLD_DAYS = '999';
  assert.equal(depositHoldDays(), 10);
  if (prev === undefined) delete process.env.DEPOSIT_HOLD_DAYS;
  else process.env.DEPOSIT_HOLD_DAYS = prev;
});

test('buildPublicTrustCard never exposes trustScore and sums deposit', () => {
  const card = buildPublicTrustCard({
    trustLevel: 4,
    depositAvailableCents: 42000_00n,
    depositLockedCents: 8000_00n,
    createdAt: new Date('2024-01-15T00:00:00.000Z'),
    ratingAverage: 4.8,
    ratingCount: 120,
    completedSales: 200,
    verifications: [
      { kind: 'PHONE_SMS', status: 'VERIFIED' },
      { kind: 'PASSPORT', status: 'VERIFIED' },
      { kind: 'VOICE_IDENTITY', status: 'PENDING' },
    ],
    proActive: true,
  });
  assert.equal(card.trustLevel, 4);
  assert.equal(card.depositTotalCents, '5000000');
  assert.equal(card.verifications.phone, true);
  assert.equal(card.verifications.passport, true);
  assert.equal(card.verifications.voiceIdentity, false);
  assert.equal(card.proActive, true);
  assert.equal('trustScore' in card, false);
  const json = JSON.stringify(card);
  assert.equal(json.includes('trustScore'), false);
});
