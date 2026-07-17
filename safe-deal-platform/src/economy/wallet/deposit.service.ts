import { Prisma } from '@prisma/client';
import { BadRequestException, Injectable } from '@nestjs/common';

export type Tx = Prisma.TransactionClient;

export type DepositSnapshot = {
  availableCents: bigint;
  lockedCents: bigint;
  totalCents: bigint;
};

/**
 * Sole path for deposit wallet mutations (available + locked).
 * Deposit funds never pay for products — trust collateral only.
 */
@Injectable()
export class DepositService {
  async getSnapshot(tx: Tx, userId: bigint): Promise<DepositSnapshot> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { depositAvailableCents: true, depositLockedCents: true, deletedAt: true },
    });
    if (user.deletedAt) throw new BadRequestException('Аккаунт недоступен.');
    return {
      availableCents: user.depositAvailableCents,
      lockedCents: user.depositLockedCents,
      totalCents: user.depositAvailableCents + user.depositLockedCents,
    };
  }

  async creditAvailable(
    tx: Tx,
    userId: bigint,
    amountCents: bigint,
    type: 'TOPUP' | 'UNLOCK' | 'ADMIN_ADJUST',
    opts: {
      idempotencyKey: string;
      orderId?: bigint;
      lockId?: string;
      paymentIntentId?: string;
      description?: string;
      markTrustDirty?: boolean;
    },
  ) {
    if (amountCents <= 0n) throw new BadRequestException('Сумма должна быть положительной.');
    const existing = await tx.depositLedgerEntry.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return existing;

    const user = await tx.user.update({
      where: { id: userId },
      data: {
        depositAvailableCents: { increment: amountCents },
        ...(opts.markTrustDirty !== false ? { trustDirty: true } : {}),
      },
      select: { depositAvailableCents: true, depositLockedCents: true },
    });
    return tx.depositLedgerEntry.create({
      data: {
        userId,
        type,
        amountCents,
        availableAfterCents: user.depositAvailableCents,
        lockedAfterCents: user.depositLockedCents,
        orderId: opts.orderId,
        lockId: opts.lockId,
        paymentIntentId: opts.paymentIntentId,
        idempotencyKey: opts.idempotencyKey,
        description: opts.description,
      },
    });
  }

  async debitAvailable(
    tx: Tx,
    userId: bigint,
    amountCents: bigint,
    type: 'WITHDRAW' | 'LOCK' | 'SEIZE' | 'ADMIN_ADJUST',
    opts: {
      idempotencyKey: string;
      orderId?: bigint;
      lockId?: string;
      description?: string;
      markTrustDirty?: boolean;
    },
  ) {
    if (amountCents <= 0n) throw new BadRequestException('Сумма должна быть положительной.');
    const existing = await tx.depositLedgerEntry.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return existing;

    const debited = await tx.user.updateMany({
      where: { id: userId, deletedAt: null, depositAvailableCents: { gte: amountCents } },
      data: {
        depositAvailableCents: { decrement: amountCents },
        ...(opts.markTrustDirty !== false ? { trustDirty: true } : {}),
      },
    });
    if (!debited.count) throw new BadRequestException('Недостаточно доступного залога.');
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { depositAvailableCents: true, depositLockedCents: true },
    });
    return tx.depositLedgerEntry.create({
      data: {
        userId,
        type,
        amountCents: -amountCents,
        availableAfterCents: user.depositAvailableCents,
        lockedAfterCents: user.depositLockedCents,
        orderId: opts.orderId,
        lockId: opts.lockId,
        idempotencyKey: opts.idempotencyKey,
        description: opts.description,
      },
    });
  }

  /** Move available → locked without changing total (sale freeze). */
  async moveAvailableToLocked(
    tx: Tx,
    userId: bigint,
    amountCents: bigint,
    opts: { idempotencyKey: string; orderId: bigint; lockId: string; description?: string },
  ) {
    if (amountCents <= 0n) return null;
    const existing = await tx.depositLedgerEntry.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return existing;

    const moved = await tx.user.updateMany({
      where: { id: userId, deletedAt: null, depositAvailableCents: { gte: amountCents } },
      data: {
        depositAvailableCents: { decrement: amountCents },
        depositLockedCents: { increment: amountCents },
        trustDirty: true,
      },
    });
    if (!moved.count) throw new BadRequestException('Недостаточно доступного залога для блокировки.');
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { depositAvailableCents: true, depositLockedCents: true },
    });
    return tx.depositLedgerEntry.create({
      data: {
        userId,
        type: 'LOCK',
        amountCents: -amountCents,
        availableAfterCents: user.depositAvailableCents,
        lockedAfterCents: user.depositLockedCents,
        orderId: opts.orderId,
        lockId: opts.lockId,
        idempotencyKey: opts.idempotencyKey,
        description: opts.description ?? 'Блокировка залога после сделки',
      },
    });
  }

  /** Move locked → available (unlock / dispute resolve). */
  async moveLockedToAvailable(
    tx: Tx,
    userId: bigint,
    amountCents: bigint,
    opts: { idempotencyKey: string; orderId?: bigint; lockId: string; description?: string },
  ) {
    if (amountCents <= 0n) return null;
    const existing = await tx.depositLedgerEntry.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return existing;

    const moved = await tx.user.updateMany({
      where: { id: userId, deletedAt: null, depositLockedCents: { gte: amountCents } },
      data: {
        depositLockedCents: { decrement: amountCents },
        depositAvailableCents: { increment: amountCents },
        trustDirty: true,
      },
    });
    if (!moved.count) throw new BadRequestException('Недостаточно заблокированного залога.');
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { depositAvailableCents: true, depositLockedCents: true },
    });
    return tx.depositLedgerEntry.create({
      data: {
        userId,
        type: 'UNLOCK',
        amountCents,
        availableAfterCents: user.depositAvailableCents,
        lockedAfterCents: user.depositLockedCents,
        orderId: opts.orderId,
        lockId: opts.lockId,
        idempotencyKey: opts.idempotencyKey,
        description: opts.description ?? 'Разблокировка залога',
      },
    });
  }
}

export function depositHoldDays(): number {
  const n = Number(process.env.DEPOSIT_HOLD_DAYS ?? 10);
  if (!Number.isFinite(n) || n < 1 || n > 365) return 10;
  return Math.floor(n);
}
