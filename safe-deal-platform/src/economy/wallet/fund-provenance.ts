/**
 * Slice 4.1 fund provenance — pure helpers.
 * Uses local string unions (not @prisma/client enums) so the IDE typechecks
 * even when Prisma Client regenerate is pending.
 */

import type { LedgerFundKindMeta, LedgerSaleKindMeta } from './ledger-write.types';

export type { LedgerFundKindMeta, LedgerSaleKindMeta } from './ledger-write.types';

export type FundBuckets = {
  owned: bigint;
  accountSale: bigint;
  otherSale: bigint;
};

export type WithdrawAllocation = FundBuckets;

export type LedgerRowForProvenance = {
  type: string;
  amountCents: bigint;
  fundKind: LedgerFundKindMeta;
  saleKind: LedgerSaleKindMeta | null;
  idempotencyKey: string;
  createdAt: Date;
  /** Resolved subcategory when SALE_PAYOUT lacked saleKind (legacy). */
  productSubcategory?: string | null;
};

export const ACCOUNT_SALE_PROTECTION_MESSAGE =
  'Средства от продажи аккаунта проходят дополнительную проверку безопасности. Вывод станет доступен после завершения периода защиты.';

export function isAccountSaleSubcategory(subcategory: string | null | undefined): boolean {
  if (!subcategory) return false;
  return subcategory.endsWith('_ACCOUNTS');
}

export function saleKindFromSubcategory(
  subcategory: string | null | undefined,
): LedgerSaleKindMeta {
  return isAccountSaleSubcategory(subcategory ?? null) ? 'ACCOUNT' : 'OTHER';
}

export function withdrawNewAccountDays(): number {
  const n = Number(
    process.env.ACCOUNT_SALE_WITHDRAWAL_BLOCK_UNTIL_ACCOUNT_AGE_DAYS
      ?? process.env.WITHDRAW_VELOCITY_NEW_ACCOUNT_DAYS
      ?? 7,
  );
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7;
}

export function withdrawVelocityWindowMs(): number {
  const n = Number(process.env.WITHDRAW_VELOCITY_WINDOW_MS ?? 86_400_000);
  return Number.isFinite(n) && n >= 60_000 ? Math.floor(n) : 86_400_000;
}

export function withdrawVelocityEnforceEnabled(): boolean {
  const raw = (process.env.WITHDRAW_VELOCITY_ENFORCE ?? 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

export function otherSaleMaxCount(): number {
  const n = Number(process.env.WITHDRAW_VELOCITY_NEW_MAX_COUNT ?? 5);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
}

export function otherSaleMaxCents(): bigint {
  const n = Number(process.env.WITHDRAW_VELOCITY_NEW_MAX_CENTS ?? 5_000_000);
  if (!Number.isFinite(n) || n < 0) return 5_000_000n;
  return BigInt(Math.floor(n));
}

export function protectionUntil(accountCreatedAt: Date, days = withdrawNewAccountDays()): Date {
  return new Date(accountCreatedAt.getTime() + days * 86_400_000);
}

export function isNewAccount(accountCreatedAt: Date, now = new Date()): boolean {
  return now.getTime() < protectionUntil(accountCreatedAt).getTime();
}

export function accountAgeDays(accountCreatedAt: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - accountCreatedAt.getTime()) / 86_400_000));
}

function resolveCreditBucket(row: LedgerRowForProvenance): keyof FundBuckets | null {
  if (row.amountCents <= 0n) return null;
  if (row.fundKind === 'USER_OWNED') return 'owned';
  if (row.fundKind === 'SALE_PROCEEDS') {
    const kind = row.saleKind
      ?? (isAccountSaleSubcategory(row.productSubcategory) ? 'ACCOUNT' : 'OTHER');
    return kind === 'ACCOUNT' ? 'accountSale' : 'otherSale';
  }
  // Legacy SYSTEM rows: infer from LedgerEntryType
  if (row.type === 'DEPOSIT' || row.type === 'REFUND' || row.type === 'DEPOSIT_RETURN') return 'owned';
  if (row.type === 'SALE_PAYOUT') {
    return isAccountSaleSubcategory(row.productSubcategory) ? 'accountSale' : 'otherSale';
  }
  if (row.type === 'ADMIN_ADJUSTMENT') return 'owned';
  return null;
}

/** Consume debit amount own-funds-first: owned → otherSale → accountSale. */
export function consumeOwnFundsFirst(buckets: FundBuckets, amount: bigint): WithdrawAllocation {
  let left = amount;
  const take = (key: keyof FundBuckets): bigint => {
    if (left <= 0n) return 0n;
    const avail = buckets[key];
    const used = avail < left ? avail : left;
    buckets[key] -= used;
    left -= used;
    return used;
  };
  return {
    owned: take('owned'),
    otherSale: take('otherSale'),
    accountSale: take('accountSale'),
  };
}

/**
 * Replay ledger → bucket state, then allocate a proposed withdrawal (own-funds-first).
 * Excludes `excludeIdempotencyKey` rows (idempotent retry of the same op).
 */
export function allocateWithdraw(
  rows: LedgerRowForProvenance[],
  amountCents: bigint,
  opts?: { excludeIdempotencyKey?: string | null },
): { bucketsAfterHistory: FundBuckets; allocation: WithdrawAllocation } {
  const buckets: FundBuckets = { owned: 0n, accountSale: 0n, otherSale: 0n };
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const row of sorted) {
    if (opts?.excludeIdempotencyKey && row.idempotencyKey === opts.excludeIdempotencyKey) continue;
    if (row.amountCents > 0n) {
      const key = resolveCreditBucket(row);
      if (key) buckets[key] += row.amountCents;
      continue;
    }
    const debit = row.amountCents < 0n ? -row.amountCents : 0n;
    if (debit > 0n) consumeOwnFundsFirst(buckets, debit);
  }

  const allocation = consumeOwnFundsFirst(
    { owned: buckets.owned, accountSale: buckets.accountSale, otherSale: buckets.otherSale },
    amountCents,
  );
  return { bucketsAfterHistory: buckets, allocation };
}

/** Prior OTHER-sale withdraw portions in window (for velocity). */
export function sumOtherSaleWithdrawalsInWindow(
  rows: LedgerRowForProvenance[],
  windowStart: Date,
  opts?: { excludeIdempotencyKey?: string | null },
): { count: number; cents: bigint } {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const buckets: FundBuckets = { owned: 0n, accountSale: 0n, otherSale: 0n };
  let count = 0;
  let cents = 0n;

  for (const row of sorted) {
    if (opts?.excludeIdempotencyKey && row.idempotencyKey === opts.excludeIdempotencyKey) continue;
    if (row.amountCents > 0n) {
      const key = resolveCreditBucket(row);
      if (key) buckets[key] += row.amountCents;
      continue;
    }
    const debit = row.amountCents < 0n ? -row.amountCents : 0n;
    if (debit <= 0n) continue;
    const alloc = consumeOwnFundsFirst(buckets, debit);

    if (row.type === 'WITHDRAWAL' && row.createdAt >= windowStart && alloc.otherSale > 0n) {
      count += 1;
      cents += alloc.otherSale;
    }
  }
  return { count, cents };
}
