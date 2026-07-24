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
   * During COMPLETED → REFUNDED: claw back seller payout without failing if short.
   * Buyer refund is caller's responsibility (always full totalAmount).
   */
  async clawbackOnRefund(
    tx: Tx,
    opts: {
      orderId: bigint;
      sellerId: bigint;
      payoutCents: bigint;
      reason?: string;
    },
  ): Promise<{ debitedCents: bigint; remainingCents: bigint; clawbackId: string | null }> {
    if (opts.payoutCents <= 0n) {
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
    const take = available < opts.payoutCents ? available : opts.payoutCents;

    if (take > 0n) {
      await this.balance.debit(tx, opts.sellerId, take, 'ADMIN_ADJUSTMENT', {
        idempotencyKey: `order:${opts.orderId}:clawback`,
        orderId: opts.orderId,
        description: 'Clawback после COMPLETED (доступный баланс)',
      });
    }

    const remaining = opts.payoutCents - take;
    const status = this.statusFor(opts.payoutCents, take);
    const row = await tx.orderClawback.create({
      data: {
        orderId: opts.orderId,
        sellerId: opts.sellerId,
        amountCents: opts.payoutCents,
        recoveredCents: take,
        status,
        reason: opts.reason?.trim() || null,
      },
    });

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
    await this.balance.debit(tx, row.sellerId, take, 'ADMIN_ADJUSTMENT', {
      idempotencyKey: `order:${row.orderId}:clawback:r${row.recoveredCents}`,
      orderId: row.orderId,
      description: 'Clawback recovery',
    });

    const status = this.statusFor(row.amountCents, nextRecovered);
    await tx.orderClawback.update({
      where: { id: row.id },
      data: { recoveredCents: nextRecovered, status },
    });

    logMoneyEvent('admin_adjust', {
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
    return { id: updated.id, status: updated.status };
  }
}
