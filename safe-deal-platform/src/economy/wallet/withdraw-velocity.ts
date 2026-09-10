import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  ACCOUNT_SALE_PROTECTION_MESSAGE,
  accountAgeDays,
  allocateWithdraw,
  isNewAccount,
  otherSaleMaxCents,
  otherSaleMaxCount,
  protectionUntil,
  sumOtherSaleWithdrawalsInWindow,
  withdrawVelocityEnforceEnabled,
  withdrawVelocityWindowMs,
  type LedgerRowForProvenance,
  type WithdrawAllocation,
} from './fund-provenance';
import type { WithdrawAssertInput } from './ledger-write.types';

type Db = Prisma.TransactionClient | PrismaService;

export type AccountSaleProtectionFlag = {
  code: 'ACCOUNT_SALE_FUNDS_UNDER_PROTECTION';
  /** Future admin plane: YELLOW = review signal, not fraud/ban. */
  severity: 'YELLOW';
  userId: string;
  accountAgeDays: number;
  restrictedAccountSaleCents: string;
  protectionUntil: string;
};

export type { WithdrawAssertInput } from './ledger-write.types';

/**
 * Slice 4.1 — provenance-aware withdraw controls + yellow security flag resolver.
 */
@Injectable()
export class WithdrawVelocityService {
  private readonly logger = new Logger(WithdrawVelocityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async lockUser(db: Db, userId: bigint): Promise<void> {
    await db.$queryRaw(
      Prisma.sql`SELECT 1 FROM "User" WHERE id = ${userId} FOR UPDATE`,
    );
  }

  /**
   * Yellow security-review signal for future admin plane.
   * Derived from User + LedgerEntry provenance — no FinancialAuditEvent table.
   */
  async resolveAccountSaleProtectionFlag(
    userId: bigint,
    db: Db = this.prisma,
    now = new Date(),
  ): Promise<AccountSaleProtectionFlag | null> {
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { createdAt: true },
    });
    const batch = await this.resolveAccountSaleProtectionFlags(
      [{ id: userId, createdAt: user.createdAt }],
      db,
      now,
    );
    return batch.get(userId.toString()) ?? null;
  }

  /**
   * Batch yellow-flag resolve — one ledger + order round-trip for many users
   * (admin dashboard / withdrawals list). Same semantics as the single-user path.
   */
  async resolveAccountSaleProtectionFlags(
    users: Array<{ id: bigint; createdAt: Date }>,
    db: Db = this.prisma,
    now = new Date(),
  ): Promise<Map<string, AccountSaleProtectionFlag>> {
    const out = new Map<string, AccountSaleProtectionFlag>();
    const newUsers = users.filter((u) => isNewAccount(u.createdAt, now));
    if (!newUsers.length) return out;

    const userIds = newUsers.map((u) => u.id);
    const rowsByUser = await this.loadProvenanceRowsForUsers(db, userIds);

    for (const user of newUsers) {
      const rows = rowsByUser.get(user.id.toString()) ?? [];
      const { bucketsAfterHistory } = allocateWithdraw(rows, 0n);
      if (bucketsAfterHistory.accountSale <= 0n) continue;
      const until = protectionUntil(user.createdAt);
      out.set(user.id.toString(), {
        code: 'ACCOUNT_SALE_FUNDS_UNDER_PROTECTION',
        severity: 'YELLOW',
        userId: user.id.toString(),
        accountAgeDays: accountAgeDays(user.createdAt, now),
        restrictedAccountSaleCents: bucketsAfterHistory.accountSale.toString(),
        protectionUntil: until.toISOString(),
      });
    }
    return out;
  }

  async assertAllowed(input: WithdrawAssertInput): Promise<{ allocation: WithdrawAllocation; newAccount: boolean }> {
    const db = input.db ?? this.prisma;
    if (input.lockUser) {
      await this.lockUser(db, input.userId);
    }

    const user = await db.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { createdAt: true },
    });
    const rows = await this.loadProvenanceRows(db, input.userId);
    const { allocation } = allocateWithdraw(rows, input.amountCents, {
      excludeIdempotencyKey: input.excludeIdempotencyKey,
    });

    const newAccount = isNewAccount(user.createdAt);
    if (!newAccount) {
      return { allocation, newAccount: false };
    }

    // Hard rule: ACCOUNT sale proceeds blocked until account age ≥ 7 days.
    if (allocation.accountSale > 0n) {
      this.logger.warn(JSON.stringify({
        msg: 'account_sale_withdraw_blocked',
        userId: input.userId.toString(),
        accountSaleCents: allocation.accountSale.toString(),
        protectionUntil: protectionUntil(user.createdAt).toISOString(),
      }));
      throw new BadRequestException(ACCOUNT_SALE_PROTECTION_MESSAGE);
    }

    // OTHER sale proceeds: rolling velocity (soft-enforceable).
    if (allocation.otherSale > 0n) {
      const windowMs = withdrawVelocityWindowMs();
      const since = new Date(Date.now() - windowMs);
      const prior = sumOtherSaleWithdrawalsInWindow(rows, since, {
        excludeIdempotencyKey: input.excludeIdempotencyKey,
      });
      const nextCount = prior.count + 1;
      const nextCents = prior.cents + allocation.otherSale;
      const maxCount = otherSaleMaxCount();
      const maxCents = otherSaleMaxCents();
      const countOk = nextCount <= maxCount;
      const sumOk = nextCents <= maxCents;

      if (!countOk || !sumOk) {
        const payload = {
          msg: 'other_sale_withdraw_velocity_breach',
          userId: input.userId.toString(),
          priorCount: prior.count,
          priorCents: prior.cents.toString(),
          nextCount,
          nextCents: nextCents.toString(),
          maxCount,
          maxCents: maxCents.toString(),
          enforce: withdrawVelocityEnforceEnabled(),
        };
        if (!withdrawVelocityEnforceEnabled()) {
          this.logger.warn(JSON.stringify(payload));
          return { allocation, newAccount: true };
        }
        this.logger.warn(JSON.stringify(payload));
        if (!countOk) {
          throw new BadRequestException(
            `Превышен лимит выводов средств от продаж (${maxCount} за ${Math.round(windowMs / 3_600_000)} ч). Попробуйте позже.`,
          );
        }
        throw new BadRequestException(
          `Превышена сумма выводов средств от продаж за период (лимит ${Number(maxCents) / 100} ₽). Попробуйте позже или уменьшите сумму.`,
        );
      }
    }

    return { allocation, newAccount: true };
  }

  private async loadProvenanceRows(db: Db, userId: bigint): Promise<LedgerRowForProvenance[]> {
    const map = await this.loadProvenanceRowsForUsers(db, [userId]);
    return map.get(userId.toString()) ?? [];
  }

  private async loadProvenanceRowsForUsers(
    db: Db,
    userIds: bigint[],
  ): Promise<Map<string, LedgerRowForProvenance[]>> {
    const out = new Map<string, LedgerRowForProvenance[]>();
    if (!userIds.length) return out;

    const entries = await db.ledgerEntry.findMany({
      where: { userId: { in: userIds } },
      orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
      select: {
        userId: true,
        type: true,
        amountCents: true,
        fundKind: true,
        saleKind: true,
        idempotencyKey: true,
        createdAt: true,
        orderId: true,
      },
    });

    const orderIds = [
      ...new Set(
        entries
          .filter((e) => e.type === 'SALE_PAYOUT' && e.orderId != null && (e.fundKind === 'SYSTEM' || !e.saleKind))
          .map((e) => e.orderId!.toString()),
      ),
    ].map((id) => BigInt(id));

    const subcategoryByOrder = new Map<string, string | null>();
    if (orderIds.length > 0) {
      const orders = await db.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          product: { select: { subcategory: true } },
        },
      });
      for (const o of orders) {
        subcategoryByOrder.set(o.id.toString(), o.product.subcategory);
      }
    }

    for (const e of entries) {
      const key = (e as { userId?: bigint }).userId != null
        ? (e as { userId: bigint }).userId.toString()
        : (userIds.length === 1 ? userIds[0]!.toString() : '');
      if (!key) continue;
      const row: LedgerRowForProvenance = {
        type: e.type,
        amountCents: e.amountCents,
        fundKind: e.fundKind as LedgerRowForProvenance['fundKind'],
        saleKind: (e.saleKind as LedgerRowForProvenance['saleKind']) ?? null,
        idempotencyKey: e.idempotencyKey,
        createdAt: e.createdAt,
        productSubcategory: e.orderId
          ? subcategoryByOrder.get(e.orderId.toString()) ?? null
          : null,
      };
      const list = out.get(key);
      if (list) list.push(row);
      else out.set(key, [row]);
    }
    return out;
  }
}
