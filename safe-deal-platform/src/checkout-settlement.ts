import type { Prisma } from '@prisma/client';
import type { AuthUser } from './common';

export type PurchaseInTxOptions = {
  /** Caller already took product + party user locks in canonical order. */
  locksHeld?: boolean;
  /** Stock already decremented by checkout reservation. */
  stockPreReserved?: boolean;
  /** Use frozen unit price from PaymentIntent metadata. */
  frozenUnitPriceCents?: bigint;
};

export interface CheckoutSettlementPort {
  purchaseInTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    productId: string,
    key: string,
    quantity: number,
    opts?: PurchaseInTxOptions,
  ): Promise<{ order: { id: bigint }; notifyIds: bigint[] }>;
}

export const CHECKOUT_SETTLEMENT = Symbol('CHECKOUT_SETTLEMENT');
