import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canLeaveReview, bayesianRating, MIN_REVIEW_AMOUNT_CENTS } from '../src/marketplace/review-policy';
import { clampWarrantyHours, formatWarranty, WARRANTY_DEFAULT_HOURS } from '../src/marketplace/warranty';
import { reliabilityScore, reliabilityWeights } from '../src/marketplace/reliability';

describe('review policy', () => {
  it('allows reviews only on completed paid deals of 100 ₽+', () => {
    const base = { status: 'COMPLETED', buyerId: 1n, authorId: 1n, totalAmountCents: MIN_REVIEW_AMOUNT_CENTS };
    assert.equal(canLeaveReview(base), true);
    assert.equal(canLeaveReview({ ...base, totalAmountCents: 9999n }), false);
    assert.equal(canLeaveReview({ ...base, status: 'REFUNDED' }), false);
    assert.equal(canLeaveReview({ ...base, authorId: 2n }), false);
  });

  it('dampens a single 5★ review toward the prior', () => {
    const oneDeal = bayesianRating(5, 1);
    assert.ok(oneDeal < 4.8);
    assert.ok(oneDeal > 4.2);
    const many = bayesianRating(5, 40);
    assert.ok(many > oneDeal);
    assert.equal(bayesianRating(4.5, 0), 0);
  });
});

describe('warranty', () => {
  it('defaults and clamps the allowed range', () => {
    assert.equal(clampWarrantyHours(undefined), WARRANTY_DEFAULT_HOURS);
    assert.equal(clampWarrantyHours(1), 5);
    assert.equal(clampWarrantyHours(9999), 720);
    assert.equal(formatWarranty(10), 'Гарантия: 10 часов');
    assert.equal(formatWarranty(24), 'Гарантия: 1 день');
    assert.equal(formatWarranty(720), 'Гарантия: 1 месяц');
  });
});

describe('reliability', () => {
  it('normalizes env weights and scores in 0..1', () => {
    const weights = reliabilityWeights({
      RELIABILITY_WEIGHT_RATING: '0.40',
      RELIABILITY_WEIGHT_REVIEWS: '0.25',
      RELIABILITY_WEIGHT_WARRANTY: '0.20',
      RELIABILITY_WEIGHT_SALES: '0.15',
    } as NodeJS.ProcessEnv);
    assert.ok(Math.abs(weights.rating + weights.reviews + weights.warranty + weights.sales - 1) < 1e-9);
    const low = reliabilityScore({ rating: 1, reviewCount: 0, warrantyHours: 5, salesCount: 0 }, weights);
    const high = reliabilityScore({ rating: 5, reviewCount: 40, warrantyHours: 720, salesCount: 80 }, weights);
    assert.ok(high > low);
    assert.ok(high <= 1);
    assert.ok(low >= 0);
  });
});
