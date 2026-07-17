import type { SellerVerificationKind, SellerVerificationStatus } from '@prisma/client';

/** Public trust card — never includes trustScore. */
export type PublicTrustCard = {
  trustLevel: number;
  depositTotalCents: string;
  registeredAt: string;
  reviewCount: number;
  salesCount: number;
  rating: number;
  verifications: {
    phone: boolean;
    phoneStages: { sms: boolean; call: boolean; voice: boolean };
    passport: boolean;
    voiceIdentity: boolean;
  };
  /** Commercial badge — not part of trust formula. */
  proActive: boolean;
};

export function buildPublicTrustCard(input: {
  trustLevel: number;
  depositAvailableCents: bigint;
  depositLockedCents: bigint;
  createdAt: Date;
  ratingAverage: { toString(): string } | number;
  ratingCount: number;
  completedSales: number;
  verifications: Array<{ kind: SellerVerificationKind; status: SellerVerificationStatus }>;
  proActive: boolean;
}): PublicTrustCard {
  const verified = new Set(
    input.verifications.filter((v) => v.status === 'VERIFIED').map((v) => v.kind),
  );
  return {
    trustLevel: input.trustLevel,
    depositTotalCents: (input.depositAvailableCents + input.depositLockedCents).toString(),
    registeredAt: input.createdAt.toISOString(),
    reviewCount: input.ratingCount,
    salesCount: input.completedSales,
    rating: Number(input.ratingAverage),
    verifications: {
      phone: verified.has('PHONE_SMS') || verified.has('PHONE_CALL') || verified.has('PHONE_VOICE'),
      phoneStages: {
        sms: verified.has('PHONE_SMS'),
        call: verified.has('PHONE_CALL'),
        voice: verified.has('PHONE_VOICE'),
      },
      passport: verified.has('PASSPORT'),
      voiceIdentity: verified.has('VOICE_IDENTITY'),
    },
    proActive: input.proActive,
  };
}
