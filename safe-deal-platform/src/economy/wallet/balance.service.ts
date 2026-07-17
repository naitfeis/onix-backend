import { Prisma } from '@prisma/client';
import { BadRequestException, Injectable } from '@nestjs/common';

export type Tx = Prisma.TransactionClient;

/**
 * Sole path for main wallet (User.balanceCents) mutations.
 * Escrow / withdraw / admin / payments must call this — never update balanceCents ad hoc.
 */
@Injectable()
export class BalanceService {
  async getAvailable(tx: Tx, userId: bigint): Promise<bigint> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balanceCents: true, deletedAt: true },
    });
    if (user.deletedAt) throw new BadRequestException('Аккаунт недоступен.');
    return user.balanceCents;
  }

  async credit(
    tx: Tx,
    userId: bigint,
    amountCents: bigint,
    type: 'DEPOSIT' | 'REFUND' | 'SALE_PAYOUT' | 'ADMIN_ADJUSTMENT',
    opts: {
      idempotencyKey: string;
      orderId?: bigint;
      description?: string;
    },
  ) {
    if (amountCents <= 0n) throw new BadRequestException('Сумма зачисления должна быть положительной.');
    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) {
      if (existing.userId !== userId || existing.type !== type || existing.amountCents !== amountCents) {
        throw new BadRequestException('Ключ идемпотентности уже использован для другой операции.');
      }
      return existing;
    }
    const user = await tx.user.update({
      where: { id: userId },
      data: { balanceCents: { increment: amountCents } },
      select: { balanceCents: true },
    });
    return tx.ledgerEntry.create({
      data: {
        userId,
        orderId: opts.orderId,
        type,
        amountCents,
        balanceAfterCents: user.balanceCents,
        idempotencyKey: opts.idempotencyKey,
        description: opts.description,
      },
    });
  }

  async debit(
    tx: Tx,
    userId: bigint,
    amountCents: bigint,
    type: 'PURCHASE_HOLD' | 'WITHDRAWAL' | 'ADMIN_ADJUSTMENT',
    opts: {
      idempotencyKey: string;
      orderId?: bigint;
      description?: string;
      /** When true, ADMIN_ADJUSTMENT may go negative only if explicit (never for purchase/withdraw). */
      allowNegative?: boolean;
    },
  ) {
    if (amountCents <= 0n) throw new BadRequestException('Сумма списания должна быть положительной.');
    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) {
      if (existing.userId !== userId || existing.type !== type || existing.amountCents !== -amountCents) {
        throw new BadRequestException('Ключ идемпотентности уже использован для другой операции.');
      }
      return existing;
    }
    if (opts.allowNegative && type === 'ADMIN_ADJUSTMENT') {
      const user = await tx.user.update({
        where: { id: userId },
        data: { balanceCents: { decrement: amountCents } },
        select: { balanceCents: true },
      });
      if (user.balanceCents < 0n) throw new BadRequestException('Корректировка создаёт отрицательный баланс.');
      return tx.ledgerEntry.create({
        data: {
          userId,
          orderId: opts.orderId,
          type,
          amountCents: -amountCents,
          balanceAfterCents: user.balanceCents,
          idempotencyKey: opts.idempotencyKey,
          description: opts.description,
        },
      });
    }
    const debited = await tx.user.updateMany({
      where: { id: userId, deletedAt: null, balanceCents: { gte: amountCents } },
      data: { balanceCents: { decrement: amountCents } },
    });
    if (!debited.count) throw new BadRequestException('Недостаточно средств.');
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balanceCents: true } });
    return tx.ledgerEntry.create({
      data: {
        userId,
        orderId: opts.orderId,
        type,
        amountCents: -amountCents,
        balanceAfterCents: user.balanceCents,
        idempotencyKey: opts.idempotencyKey,
        description: opts.description,
      },
    });
  }
}
