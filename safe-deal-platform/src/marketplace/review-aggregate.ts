import { bayesianRating, type ReviewHideReason } from './review-policy';

type ReviewClient = {
  review: {
    aggregate: (args: {
      where: { subjectId: bigint; hiddenAt: null };
      _avg: { rating: true };
      _count: true;
    }) => Promise<{ _avg: { rating: number | null }; _count: number }>;
  };
  user: {
    findUnique: (args: {
      where: { id: bigint };
      select: { ratingAverage: true; ratingCount: true };
    }) => Promise<{ ratingAverage: { toNumber?: () => number } | number; ratingCount: number } | null>;
    update: (args: {
      where: { id: bigint };
      data: { ratingAverage: number; ratingCount: number; trustDirty?: boolean };
    }) => Promise<unknown>;
  };
};

export async function recomputeSellerRating(
  tx: ReviewClient,
  subjectId: bigint,
  opts?: { floorPrevious?: boolean },
): Promise<{ average: number; count: number }> {
  const aggregate = await tx.review.aggregate({
    where: { subjectId, hiddenAt: null },
    _avg: { rating: true },
    _count: true,
  });
  const count = aggregate._count;
  const rawAvg = aggregate._avg.rating ?? 0;
  let average = count > 0 ? bayesianRating(rawAvg, count) : 0;

  if (opts?.floorPrevious) {
    const prev = await tx.user.findUnique({
      where: { id: subjectId },
      select: { ratingAverage: true, ratingCount: true },
    });
    if (prev) {
      const prevAvg = Number(prev.ratingAverage);
      if (Number.isFinite(prevAvg) && average < prevAvg) average = prevAvg;
      const nextCount = Math.max(count, prev.ratingCount);
      await tx.user.update({
        where: { id: subjectId },
        data: {
          ratingAverage: Math.round(average * 100) / 100,
          ratingCount: nextCount,
        },
      });
      return { average, count: nextCount };
    }
  }

  await tx.user.update({
    where: { id: subjectId },
    data: {
      ratingAverage: Math.round(average * 100) / 100,
      ratingCount: count,
      ...(opts?.floorPrevious ? {} : { trustDirty: true }),
    },
  });
  return { average, count };
}

export async function hideReviewsForOrder(
  tx: ReviewClient & {
    review: ReviewClient['review'] & {
      updateMany: (args: {
        where: { orderId: bigint; hiddenAt: null };
        data: { hiddenAt: Date; hiddenReason: ReviewHideReason };
      }) => Promise<{ count: number }>;
      findMany: (args: {
        where: { orderId: bigint };
        select: { subjectId: true };
      }) => Promise<Array<{ subjectId: bigint }>>;
    };
  },
  orderId: bigint,
  reason: ReviewHideReason,
): Promise<void> {
  const existing = await tx.review.findMany({
    where: { orderId },
    select: { subjectId: true },
  });
  if (!existing.length) return;
  await tx.review.updateMany({
    where: { orderId, hiddenAt: null },
    data: { hiddenAt: new Date(), hiddenReason: reason },
  });
  const subjects = [...new Set(existing.map((row) => row.subjectId.toString()))];
  for (const id of subjects) {
    await recomputeSellerRating(tx, BigInt(id));
  }
}
