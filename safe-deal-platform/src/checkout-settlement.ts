import type { Prisma } from '@prisma/client';
import type { AuthUser } from './common';

export interface CheckoutSettlementPort {
  purchaseInTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    productId: string,
    key: string,
    quantity: number,
  ): Promise<{ order: { id: bigint }; notifyIds: bigint[] }>;
}

export const CHECKOUT_SETTLEMENT = Symbol('CHECKOUT_SETTLEMENT');
