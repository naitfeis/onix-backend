import { Injectable } from '@nestjs/common';
import { logMoneyEvent } from '../../observability/money-event';
import { createId } from './cuid';
import { DepositService, depositHoldDays, type Tx } from './deposit.service';

/**
 * Post-sale deposit freeze. Unlock is lazy (on wallet access) — no cron dependency.
 * Matches project infra: domain transactions + Serializable, same as escrow.
 */
@Injectable()
export class LockService {
  constructor(private readonly deposit: DepositService) {}

  /**
   * After COMPLETED: freeze min(dealAmount, available) until unlockAt.
   * Idempotent per orderId.
   */
  async lockOnSaleComplete(tx: Tx, sellerId: bigint, orderId: bigint, dealAmountCents: bigint) {
    const existing = await tx.depositLock.findUnique({ where: { orderId } });
    if (existing) return existing;

    const snap = await this.deposit.getSnapshot(tx, sellerId);
    const amount = dealAmountCents < snap.availableCents ? dealAmountCents : snap.availableCents;
    if (amount <= 0n) return null;

    const unlockAt = new Date(Date.now() + depositHoldDays() * 24 * 60 * 60 * 1000);
    const lockId = createId();
    const lock = await tx.depositLock.create({
      data: {
        id: lockId,
        userId: sellerId,
        orderId,
        amountCents: amount,
        status: 'ACTIVE',
        unlockAt,
      },
    });
    await this.deposit.moveAvailableToLocked(tx, sellerId, amount, {
      idempotencyKey: `deposit-lock:order:${orderId}`,
      orderId,
      lockId: lock.id,
    });
    await tx.trustHistoryEvent.create({
      data: {
        userId: sellerId,
        type: 'DEPOSIT_LOCKED',
        payload: {
          orderId: orderId.toString(),
          amountCents: amount.toString(),
          unlockAt: unlockAt.toISOString(),
        },
      },
    });
    logMoneyEvent('escrow_lock', {
      status: 'success',
      operationId: `deposit-lock:order:${orderId}`,
      dealId: orderId.toString(),
      userId: sellerId.toString(),
      amount: amount.toString(),
    });
    return lock;
  }

  /** Release ACTIVE / HELD_DISPUTE lock for an order (refund / cancel path). */
  async releaseForOrder(tx: Tx, orderId: bigint) {
    const lock = await tx.depositLock.findUnique({ where: { orderId } });
    if (!lock) return null;
    if (lock.status === 'RELEASED' || lock.status === 'SEIZED') return lock;
    return this.releaseLock(tx, lock.id);
  }

  /**
   * Keep frozen until dispute resolution.
   * - Missing lock (pre-complete dispute): freeze available deposit as HELD_DISPUTE.
   * - ACTIVE → HELD_DISPUTE.
   * - RELEASED (lazy unlock already ran): re-freeze from available into HELD_DISPUTE.
   * Never a silent no-op when seller still has deposit available.
   */
  async holdForDispute(tx: Tx, orderId: bigint) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { sellerId: true, payoutCents: true, totalAmountCents: true },
    });
    if (!order) return null;

    const existing = await tx.depositLock.findUnique({ where: { orderId } });
    if (existing?.status === 'HELD_DISPUTE') return existing;
    if (existing?.status === 'SEIZED') return existing;

    const target = order.payoutCents > 0n
      ? order.payoutCents
      : order.totalAmountCents;

    if (existing?.status === 'ACTIVE') {
      return tx.depositLock.update({
        where: { id: existing.id },
        data: { status: 'HELD_DISPUTE' },
      });
    }

    if (existing?.status === 'RELEASED') {
      const snap = await this.deposit.getSnapshot(tx, order.sellerId);
      const amount = existing.amountCents < snap.availableCents
        ? existing.amountCents
        : snap.availableCents;
      if (amount <= 0n) return existing;
      await this.deposit.moveAvailableToLocked(tx, order.sellerId, amount, {
        idempotencyKey: `deposit-relock:dispute:${orderId}:${existing.id}`,
        orderId,
        lockId: existing.id,
      });
      return tx.depositLock.update({
        where: { id: existing.id },
        data: {
          status: 'HELD_DISPUTE',
          amountCents: amount,
          releasedAt: null,
          unlockAt: new Date(Date.now() + depositHoldDays() * 24 * 60 * 60 * 1000),
        },
      });
    }

    // No lock yet (dispute before COMPLETED) — create HELD_DISPUTE collateral if deposit exists.
    const snap = await this.deposit.getSnapshot(tx, order.sellerId);
    const amount = target < snap.availableCents ? target : snap.availableCents;
    if (amount <= 0n) return null;

    const lockId = createId();
    const unlockAt = new Date(Date.now() + depositHoldDays() * 24 * 60 * 60 * 1000);
    const lock = await tx.depositLock.create({
      data: {
        id: lockId,
        userId: order.sellerId,
        orderId,
        amountCents: amount,
        status: 'HELD_DISPUTE',
        unlockAt,
      },
    });
    await this.deposit.moveAvailableToLocked(tx, order.sellerId, amount, {
      idempotencyKey: `deposit-lock:dispute:${orderId}`,
      orderId,
      lockId: lock.id,
    });
    logMoneyEvent('escrow_lock', {
      status: 'success',
      operationId: `deposit-lock:dispute:${orderId}`,
      dealId: orderId.toString(),
      userId: order.sellerId.toString(),
      amount: amount.toString(),
      reason: 'HELD_DISPUTE',
    });
    return lock;
  }

  /** Release HELD_DISPUTE back to ACTIVE (or unlock if past unlockAt). */
  async releaseDisputeHold(tx: Tx, orderId: bigint) {
    const lock = await tx.depositLock.findUnique({ where: { orderId } });
    if (!lock || lock.status !== 'HELD_DISPUTE') return lock;
    if (lock.unlockAt <= new Date()) {
      return this.releaseLock(tx, lock.id);
    }
    return tx.depositLock.update({
      where: { id: lock.id },
      data: { status: 'ACTIVE' },
    });
  }

  async releaseLock(tx: Tx, lockId: string) {
    const lock = await tx.depositLock.findUnique({ where: { id: lockId } });
    if (!lock) return null;
    if (lock.status === 'RELEASED' || lock.status === 'SEIZED') return lock;

    await this.deposit.moveLockedToAvailable(tx, lock.userId, lock.amountCents, {
      idempotencyKey: `deposit-unlock:${lockId}`,
      orderId: lock.orderId,
      lockId,
    });
    const updated = await tx.depositLock.update({
      where: { id: lockId },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    logMoneyEvent('escrow_release', {
      status: 'success',
      operationId: `deposit-unlock:${lockId}`,
      dealId: lock.orderId.toString(),
      userId: lock.userId.toString(),
      amount: lock.amountCents.toString(),
    });
    await tx.trustHistoryEvent.create({
      data: {
        userId: lock.userId,
        type: 'DEPOSIT_UNLOCKED',
        payload: {
          orderId: lock.orderId.toString(),
          amountCents: lock.amountCents.toString(),
          lockId,
        },
      },
    });
    return updated;
  }

  /** Lazy unlock: release ACTIVE locks whose unlockAt has passed for this user. */
  async releaseExpiredForUser(tx: Tx, userId: bigint) {
    const due = await tx.depositLock.findMany({
      where: { userId, status: 'ACTIVE', unlockAt: { lte: new Date() } },
      take: 50,
      orderBy: { unlockAt: 'asc' },
    });
    for (const lock of due) {
      await this.releaseLock(tx, lock.id);
    }
    return due.length;
  }
}
