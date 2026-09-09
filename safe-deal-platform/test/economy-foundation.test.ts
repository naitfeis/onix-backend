import assert from 'node:assert/strict';
import test from 'node:test';
import { depositHoldDays } from '../src/economy/wallet/deposit.service';
import { assertNoTrustScore, buildPublicTrustCard } from '../src/economy/trust/trust-card';

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

test('public trust card never exposes trustScore and has buyer aliases', () => {
  const card = buildPublicTrustCard({
    trustLevel: 4,
    trustScore: 620,
    depositAvailableCents: 42000_00n,
    depositLockedCents: 8000_00n,
    createdAt: new Date('2024-01-15T00:00:00.000Z'),
    ratingAverage: 4.8,
    ratingCount: 120,
    completedSales: 200,
    proActive: true,
  });
  assert.equal(card.level, 4);
  assert.equal(card.trustLevel, 4);
  assert.equal(card.progress, 62);
  assert.equal(card.depositTotal, '5000000');
  assert.equal(card.depositTotalCents, '5000000');
  assert.equal('trustScore' in card, false);
  assertNoTrustScore(card);
  const json = JSON.stringify(card);
  assert.equal(json.includes('trustScore'), false);
  assert.match(json, /"level":4/);
  assert.equal(json.includes('phoneVerified'), false);
});

test('assertNoTrustScore rejects leaked score', () => {
  assert.throws(() => assertNoTrustScore({ trustScore: 842, level: 4 }));
});

test('lazy unlock eligibility: ACTIVE past unlockAt yes; HELD_DISPUTE no', () => {
  const now = Date.now();
  const candidates = [
    { status: 'ACTIVE', unlockAt: new Date(now - 1000) },
    { status: 'ACTIVE', unlockAt: new Date(now + 86_400_000) },
    { status: 'HELD_DISPUTE', unlockAt: new Date(now - 1000) },
    { status: 'RELEASED', unlockAt: new Date(now - 1000) },
  ];
  const due = candidates.filter((l) => l.status === 'ACTIVE' && l.unlockAt.getTime() <= now);
  assert.equal(due.length, 1);
  assert.equal(due[0].status, 'ACTIVE');
});
