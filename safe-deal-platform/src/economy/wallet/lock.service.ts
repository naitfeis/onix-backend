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

  /** Keep frozen until dispute resolution. */
  async holdForDispute(tx: Tx, orderId: bigint) {
    const lock = await tx.depositLock.findUnique({ where: { orderId } });
    if (!lock || lock.status !== 'ACTIVE') return lock;
    return tx.depositLock.update({
      where: { id: lock.id },
      data: { status: 'HELD_DISPUTE' },
    });
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
