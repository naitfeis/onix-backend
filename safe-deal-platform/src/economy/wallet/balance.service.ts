import { Prisma, type LedgerSource } from '@prisma/client';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { MetricsService } from '../../observability/metrics.service';
import { logMoneyEvent } from '../../observability/money-event';
import type {
  LedgerFundKindMeta,
  LedgerSaleKindMeta,
  LedgerWriteMeta,
} from './ledger-write.types';

export type Tx = Prisma.TransactionClient;

export type {
  LedgerFundKindMeta,
  LedgerSaleKindMeta,
  LedgerWriteMeta,
} from './ledger-write.types';

/**
 * Sole path for main wallet (User.balanceCents) mutations.
 * Escrow / withdraw / admin / payments must call this — never update balanceCents ad hoc.
 */
@Injectable()
export class BalanceService {
  constructor(@Optional() private readonly metrics?: MetricsService) {}

  async getAvailable(tx: Tx, userId: bigint): Promise<bigint> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balanceCents: true, deletedAt: true },
    });
    if (user.deletedAt) throw new BadRequestException('Аккаунт недоступен.');
    return user.balanceCents;
  }

  private enrichData(opts: LedgerWriteMeta): {
    actorUserId?: bigint | null;
    source: LedgerSource;
    correlationId?: string | null;
    fundKind: LedgerFundKindMeta;
    saleKind?: LedgerSaleKindMeta | null;
  } {
    return {
      actorUserId: opts.actorUserId ?? null,
      source: opts.source ?? 'SYSTEM',
      correlationId: opts.correlationId?.slice(0, 64) ?? null,
      fundKind: opts.fundKind ?? 'SYSTEM',
      saleKind: opts.saleKind ?? null,
    };
  }

  async credit(
    tx: Tx,
    userId: bigint,
    amountCents: bigint,
    type: 'DEPOSIT' | 'REFUND' | 'SALE_PAYOUT' | 'ADMIN_ADJUSTMENT' | 'DEPOSIT_RETURN',
    opts: LedgerWriteMeta,
  ) {
    if (amountCents <= 0n) throw new BadRequestException('Сумма зачисления должна быть положительной.');
    const enrich = this.enrichData(opts);
    try {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
      if (existing) {
        if (existing.userId !== userId || existing.type !== type || existing.amountCents !== amountCents) {
          throw new BadRequestException('Ключ идемпотентности уже использован для другой операции.');
        }
        this.metrics?.recordMoneyOp(`credit:${type}`, true);
        return existing;
      }
      const user = await tx.user.update({
        where: { id: userId },
        data: { balanceCents: { increment: amountCents } },
        select: { balanceCents: true },
      });
      const entry = await tx.ledgerEntry.create({
        data: {
          userId,
          orderId: opts.orderId,
          type,
          amountCents,
          balanceAfterCents: user.balanceCents,
          idempotencyKey: opts.idempotencyKey,
          description: opts.description,
          ...enrich,
        },
      });
      this.metrics?.recordMoneyOp(`credit:${type}`, true);
      logMoneyEvent(type === 'SALE_PAYOUT' ? 'seller_payout' : type === 'REFUND' ? 'refund' : 'deposit', {
        status: 'success',
        operationId: opts.idempotencyKey,
        dealId: opts.orderId?.toString(),
        userId: userId.toString(),
        amount: amountCents.toString(),
        ledgerType: type,
        source: enrich.source,
        fundKind: enrich.fundKind,
        ...(enrich.correlationId ? { requestId: enrich.correlationId } : {}),
      });
      return entry;
    } catch (err) {
      if (!(err instanceof BadRequestException)) {
        this.metrics?.recordMoneyOp(`credit:${type}`, false);
      }
      throw err;
    }
  }

  async debit(
    tx: Tx,
    userId: bigint,
    amountCents: bigint,
    type: 'PURCHASE_HOLD' | 'WITHDRAWAL' | 'ADMIN_ADJUSTMENT' | 'DEPOSIT_FUND' | 'CLAWBACK',
    opts: LedgerWriteMeta & {
      /** When true, ADMIN_ADJUSTMENT may go negative only if explicit (never for purchase/withdraw). */
      allowNegative?: boolean;
    },
  ) {
    if (amountCents <= 0n) throw new BadRequestException('Сумма списания должна быть положительной.');
    const enrich = this.enrichData(opts);
    try {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
      if (existing) {
        if (existing.userId !== userId || existing.type !== type || existing.amountCents !== -amountCents) {
          throw new BadRequestException('Ключ идемпотентности уже использован для другой операции.');
        }
        this.metrics?.recordMoneyOp(`debit:${type}`, true);
        return existing;
      }
      if (opts.allowNegative && type === 'ADMIN_ADJUSTMENT') {
        const user = await tx.user.update({
          where: { id: userId },
          data: { balanceCents: { decrement: amountCents } },
          select: { balanceCents: true },
        });
        if (user.balanceCents < 0n) throw new BadRequestException('Корректировка создаёт отрицательный баланс.');
        const entry = await tx.ledgerEntry.create({
          data: {
            userId,
            orderId: opts.orderId,
            type,
            amountCents: -amountCents,
            balanceAfterCents: user.balanceCents,
            idempotencyKey: opts.idempotencyKey,
            description: opts.description,
            ...enrich,
          },
        });
        this.metrics?.recordMoneyOp(`debit:${type}`, true);
        logMoneyEvent('admin_adjust', {
          status: 'success',
          operationId: opts.idempotencyKey,
          dealId: opts.orderId?.toString(),
          userId: userId.toString(),
          amount: amountCents.toString(),
          ledgerType: type,
          source: enrich.source,
          fundKind: enrich.fundKind,
          ...(enrich.correlationId ? { requestId: enrich.correlationId } : {}),
        });
        return entry;
      }
      const debited = await tx.user.updateMany({
        where: { id: userId, deletedAt: null, balanceCents: { gte: amountCents } },
        data: { balanceCents: { decrement: amountCents } },
      });
      if (!debited.count) throw new BadRequestException('Недостаточно средств.');
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balanceCents: true } });
      const entry = await tx.ledgerEntry.create({
        data: {
          userId,
          orderId: opts.orderId,
          type,
          amountCents: -amountCents,
          balanceAfterCents: user.balanceCents,
          idempotencyKey: opts.idempotencyKey,
          description: opts.description,
          ...enrich,
        },
      });
      this.metrics?.recordMoneyOp(`debit:${type}`, true);
      logMoneyEvent(
        type === 'PURCHASE_HOLD'
          ? 'purchase_hold'
          : type === 'WITHDRAWAL'
            ? 'withdrawal'
            : type === 'CLAWBACK'
              ? 'refund'
              : 'admin_adjust',
        {
          status: 'success',
          operationId: opts.idempotencyKey,
          dealId: opts.orderId?.toString(),
          userId: userId.toString(),
          amount: amountCents.toString(),
          ledgerType: type,
          source: enrich.source,
          fundKind: enrich.fundKind,
          ...(enrich.correlationId ? { requestId: enrich.correlationId } : {}),
        },
      );
      return entry;
    } catch (err) {
      if (!(err instanceof BadRequestException)) {
        this.metrics?.recordMoneyOp(`debit:${type}`, false);
      }
      throw err;
    }
  }
}
