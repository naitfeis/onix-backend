import type { LedgerSource } from '@prisma/client';

/** Slice 4.1 fund provenance tags (local unions — do not import Prisma enums here). */
export type LedgerFundKindMeta = 'USER_OWNED' | 'SALE_PROCEEDS' | 'SYSTEM';
export type LedgerSaleKindMeta = 'ACCOUNT' | 'OTHER';

/**
 * Options for BalanceService.credit / debit.
 * Keep this file tiny and dependency-light so the IDE always resolves it.
 */
export type LedgerWriteMeta = {
  idempotencyKey: string;
  orderId?: bigint;
  description?: string;
  actorUserId?: bigint | null;
  source?: LedgerSource;
  correlationId?: string | null;
  fundKind?: LedgerFundKindMeta;
  saleKind?: LedgerSaleKindMeta | null;
};

export type WithdrawAssertInput = {
  userId: bigint;
  amountCents: bigint;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
  excludeIdempotencyKey?: string | null;
  lockUser?: boolean;
};
