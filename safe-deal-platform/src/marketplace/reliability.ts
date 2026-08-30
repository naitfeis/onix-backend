import { WARRANTY_MAX_HOURS } from './warranty';

export interface ReliabilityWeights {
  rating: number;
  reviews: number;
  warranty: number;
  sales: number;
}

export function reliabilityWeights(env: NodeJS.ProcessEnv = process.env): ReliabilityWeights {
  const rating = num(env.RELIABILITY_WEIGHT_RATING, 0.4);
  const reviews = num(env.RELIABILITY_WEIGHT_REVIEWS, 0.25);
  const warranty = num(env.RELIABILITY_WEIGHT_WARRANTY, 0.2);
  const sales = num(env.RELIABILITY_WEIGHT_SALES, 0.15);
  const sum = rating + reviews + warranty + sales;
  if (sum <= 0) {
    return { rating: 0.4, reviews: 0.25, warranty: 0.2, sales: 0.15 };
  }
  return {
    rating: rating / sum,
    reviews: reviews / sum,
    warranty: warranty / sum,
    sales: sales / sum,
  };
}

/** 0..1 weighted score from normalized factors (for sort / recommendations). */
export function reliabilityScore(input: {
  rating: number;
  reviewCount: number;
  warrantyHours: number;
  salesCount: number;
}, weights: ReliabilityWeights = reliabilityWeights()): number {
  const rating = clamp01(input.rating / 5);
  const reviews = clamp01(Math.log10(1 + Math.max(0, input.reviewCount)) / Math.log10(51));
  const warranty = clamp01(Math.max(0, input.warrantyHours) / WARRANTY_MAX_HOURS);
  const sales = clamp01(Math.log10(1 + Math.max(0, input.salesCount)) / Math.log10(101));
  return (
    weights.rating * rating
    + weights.reviews * reviews
    + weights.warranty * warranty
    + weights.sales * sales
  );
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
