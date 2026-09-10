import { Injectable, NotFoundException } from '@nestjs/common';
import { ClawbackStatus } from '@prisma/client';
import { logMoneyEvent } from '../../observability/money-event';
import { BalanceService, type Tx } from './balance.service';

/**
 * Post-COMPLETED refund debt — separate from User.balanceCents.
 * Ledger debit takes only available balance; remainder stays as OrderClawback.
 */
@Injectable()
export class ClawbackService {
  constructor(private readonly balance: BalanceService) {}

  remainingCents(row: { amountCents: bigint; recoveredCents: bigint }): bigint {
    const left = row.amountCents - row.recoveredCents;
    return left > 0n ? left : 0n;
  }

  statusFor(amountCents: bigint, recoveredCents: bigint): ClawbackStatus {
    if (recoveredCents <= 0n) return 'OPEN';
    if (recoveredCents >= amountCents) return 'RECOVERED';
    return 'PARTIAL';
  }

  /**
   * During COMPLETED → REFUNDED: claw back seller proceeds without failing if short.
   * amountCents must be ≤ seller SALE_PAYOUT (payoutCents). Never claw back platform fee from seller.
   * Buyer refund (full totalAmount) is caller's responsibility.
   */
  async clawbackOnRefund(
    tx: Tx,
    opts: {
      orderId: bigint;
      sellerId: bigint;
      amountCents: bigint;
      /** @deprecated use amountCents — must equal seller proceeds, not order total */
      payoutCents?: bigint;
      reason?: string;
    },
  ): Promise<{ debitedCents: bigint; remainingCents: bigint; clawbackId: string | null }> {
    const target = opts.amountCents > 0n ? opts.amountCents : (opts.payoutCents ?? 0n);
    if (target <= 0n) {
      return { debitedCents: 0n, remainingCents: 0n, clawbackId: null };
    }

    const existing = await tx.orderClawback.findUnique({ where: { orderId: opts.orderId } });
    if (existing) {
      return {
        debitedCents: existing.recoveredCents,
        remainingCents: this.remainingCents(existing),
        clawbackId: existing.id,
      };
    }

    const available = await this.balance.getAvailable(tx, opts.sellerId);
    // Never debit more than available (no negative balance) and never more than target (seller proceeds).
    const take = available < target ? available : target;

    if (take > 0n) {
      await this.balance.debit(tx, opts.sellerId, take, 'CLAWBACK', {
        idempotencyKey: `order:${opts.orderId}:clawback`,
        orderId: opts.orderId,
        description: 'Clawback после COMPLETED (доступный баланс)',
        source: 'SYSTEM',
        fundKind: 'SALE_PROCEEDS',
      });
    }

    const remaining = target - take;
    const status = this.statusFor(target, take);
    const row = await tx.orderClawback.create({
      data: {
        orderId: opts.orderId,
        sellerId: opts.sellerId,
        amountCents: target,
        recoveredCents: take,
        status,
        reason: opts.reason?.trim() || null,
      },
    });

    if (remaining > 0n) {
      await this.flagClawbackDebt(tx, opts.sellerId, opts.orderId, remaining);
    }

    logMoneyEvent('refund', {
      status: 'success',
      operationId: `order:${opts.orderId}:clawback`,
      dealId: opts.orderId.toString(),
      userId: opts.sellerId.toString(),
      amount: take.toString(),
      remainingCents: remaining.toString(),
      clawbackStatus: status,
    });

    return {
      debitedCents: take,
      remainingCents: remaining,
      clawbackId: row.id,
    };
  }

  /** Sweep OPEN/PARTIAL — debit available balance into recoveredCents. */
  async recoverOpen(
    tx: Tx,
    clawbackId: string,
  ): Promise<{ recoveredNow: bigint; status: ClawbackStatus }> {
    const row = await tx.orderClawback.findUnique({ where: { id: clawbackId } });
    if (!row || row.status === 'RECOVERED' || row.status === 'WAIVED') {
      return { recoveredNow: 0n, status: row?.status ?? 'RECOVERED' };
    }

    const left = this.remainingCents(row);
    if (left <= 0n) {
      await tx.orderClawback.update({
        where: { id: row.id },
        data: { status: 'RECOVERED', recoveredCents: row.amountCents },
      });
      return { recoveredNow: 0n, status: 'RECOVERED' };
    }

    const available = await this.balance.getAvailable(tx, row.sellerId);
    const take = available < left ? available : left;
    if (take <= 0n) {
      return { recoveredNow: 0n, status: row.status };
    }

    const nextRecovered = row.recoveredCents + take;
    await this.balance.debit(tx, row.sellerId, take, 'CLAWBACK', {
      idempotencyKey: `order:${row.orderId}:clawback:r${row.recoveredCents}`,
      orderId: row.orderId,
      description: 'Clawback recovery',
      source: 'WORKER',
      fundKind: 'SALE_PROCEEDS',
    });

    const status = this.statusFor(row.amountCents, nextRecovered);
    await tx.orderClawback.update({
      where: { id: row.id },
      data: { recoveredCents: nextRecovered, status },
    });

    if (status === 'RECOVERED') {
      await this.clearClawbackDebtFlagIfClean(tx, row.sellerId);
    }

    logMoneyEvent('refund', {
      status: 'success',
      operationId: `order:${row.orderId}:clawback:r${row.recoveredCents}`,
      dealId: row.orderId.toString(),
      userId: row.sellerId.toString(),
      amount: take.toString(),
      clawbackStatus: status,
    });

    return { recoveredNow: take, status };
  }

  /** Drain open clawbacks before seller withdraws main balance. */
  async recoverAllForSeller(tx: Tx, sellerId: bigint): Promise<number> {
    const open = await tx.orderClawback.findMany({
      where: { sellerId, status: { in: ['OPEN', 'PARTIAL'] } },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    let n = 0;
    for (const row of open) {
      const { recoveredNow } = await this.recoverOpen(tx, row.id);
      if (recoveredNow > 0n) n += 1;
    }
    return n;
  }

  async hasOpenDebt(tx: Tx, sellerId: bigint): Promise<boolean> {
    const row = await tx.orderClawback.findFirst({
      where: { sellerId, status: { in: ['OPEN', 'PARTIAL'] } },
      select: { id: true },
    });
    return Boolean(row);
  }

  /**
   * Visible withdraw block + security signal while clawback debt remains.
   * Cleared only when no OPEN/PARTIAL clawbacks left and no Risk Engine lock.
   */
  private async flagClawbackDebt(
    tx: Tx,
    sellerId: bigint,
    orderId: bigint,
    remainingCents: bigint,
  ): Promise<void> {
    const now = new Date();
    await tx.user.update({
      where: { id: sellerId },
      data: { withdrawBlockedAt: now },
    });
    await tx.securityEvent.create({
      data: {
        userId: sellerId,
        type: 'CLAWBACK_DEBT',
        severity: 80,
        status: 'OPEN',
        payload: {
          orderId: orderId.toString(),
          remainingCents: remainingCents.toString(),
          reason: 'Post-complete clawback shortfall after seller withdrawal',
        },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: 'CLAWBACK_DEBT_OPEN',
        entity: 'OrderClawback',
        entityId: orderId.toString(),
        metadata: {
          sellerId: sellerId.toString(),
          remainingCents: remainingCents.toString(),
        },
      },
    });
  }

  private async clearClawbackDebtFlagIfClean(tx: Tx, sellerId: bigint): Promise<void> {
    if (await this.hasOpenDebt(tx, sellerId)) return;
    const user = await tx.user.findUnique({
      where: { id: sellerId },
      select: { securityLockedAt: true, withdrawBlockedAt: true },
    });
    if (!user?.withdrawBlockedAt || user.securityLockedAt) return;
    await tx.user.update({
      where: { id: sellerId },
      data: { withdrawBlockedAt: null },
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: 'CLAWBACK_DEBT_CLEARED',
        entity: 'User',
        entityId: sellerId.toString(),
        metadata: { reason: 'all_clawbacks_recovered' },
      },
    });
  }

  async waive(
    tx: Tx,
    orderId: bigint,
    reason: string,
  ): Promise<{ id: string; status: ClawbackStatus }> {
    const row = await tx.orderClawback.findUnique({ where: { orderId } });
    if (!row) throw new NotFoundException('Clawback не найден.');
    if (row.status === 'RECOVERED' || row.status === 'WAIVED') {
      return { id: row.id, status: row.status };
    }
    const updated = await tx.orderClawback.update({
      where: { id: row.id },
      data: {
        status: 'WAIVED',
        reason: reason.trim().slice(0, 1000),
      },
    });
    await this.clearClawbackDebtFlagIfClean(tx, row.sellerId);
    return { id: updated.id, status: updated.status };
  }
}
