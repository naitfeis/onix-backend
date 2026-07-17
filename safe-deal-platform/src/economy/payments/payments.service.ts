import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PaymentProviderCode, PaymentWallet, Prisma } from '@prisma/client';
import { AuthUser } from '../../common';
import { PrismaService } from '../../prisma.service';
import { ManualPaymentProvider, isManualPaymentsEnabled } from './manual.provider';
import type { PaymentProvider } from './payment-provider';
import { BalanceService } from '../wallet/balance.service';
import { DepositService } from '../wallet/deposit.service';
import { TrustService } from '../trust/trust.service';

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

@Injectable()
export class PaymentsService {
  private readonly providers: Map<PaymentProviderCode, PaymentProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly balance: BalanceService,
    private readonly deposit: DepositService,
    private readonly trust: TrustService,
    manual: ManualPaymentProvider,
  ) {
    this.providers = new Map();
    for (const p of [
      manual,
      // Stubs registered by code lookup — real adapters replace these later.
    ]) {
      this.providers.set(p.code, p);
    }
  }

  private provider(code: PaymentProviderCode): PaymentProvider {
    const p = this.providers.get(code);
    if (!p) {
      throw new BadRequestException(`Провайдер ${code} не зарегистрирован.`);
    }
    if (code !== 'MANUAL') {
      throw new ForbiddenException(`Платёжный провайдер ${code} ещё не подключён.`);
    }
    return p;
  }

  async createTopUp(
    user: AuthUser,
    dto: {
      wallet: PaymentWallet;
      amountCents: number;
      provider: PaymentProviderCode;
      idempotencyKey: string;
    },
  ) {
    if (dto.amountCents < 100) throw new BadRequestException('Минимальная сумма пополнения — 1 ₽.');
    if (dto.provider === 'MANUAL') {
      if (!user.isAdmin && !isManualPaymentsEnabled()) {
        throw new ForbiddenException('Manual-пополнение отключено. Включите MANUAL_PAYMENTS_ENABLED или используйте admin.');
      }
    }
    const provider = this.provider(dto.provider);
    const amountCents = BigInt(dto.amountCents);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.paymentIntent.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (existing) {
        if (existing.userId !== user.id || existing.amountCents !== amountCents || existing.wallet !== dto.wallet) {
          throw new ConflictException('Ключ идемпотентности уже использован.');
        }
        return existing;
      }
      const created = await provider.createIntent({
        userId: user.id,
        wallet: dto.wallet,
        amountCents,
        idempotencyKey: dto.idempotencyKey,
      });
      return tx.paymentIntent.create({
        data: {
          userId: user.id,
          wallet: dto.wallet,
          provider: dto.provider,
          amountCents,
          status: created.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'PENDING',
          idempotencyKey: dto.idempotencyKey,
          providerRef: created.providerRef,
          metadata: (created.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          succeededAt: created.status === 'SUCCEEDED' ? new Date() : undefined,
        },
      });
    }, SERIALIZABLE);
  }

  async confirmManual(user: AuthUser, intentId: string) {
    if (!user.isAdmin && !isManualPaymentsEnabled()) {
      throw new ForbiddenException('Подтверждение Manual-платежа недоступно.');
    }
    return this.prisma.$transaction(async (tx) => {
      const intent = await tx.paymentIntent.findUnique({ where: { id: intentId } });
      if (!intent) throw new NotFoundException('Платёж не найден.');
      if (intent.userId !== user.id && !user.isAdmin) {
        throw new NotFoundException('Платёж не найден.');
      }
      if (intent.provider !== 'MANUAL') {
        throw new BadRequestException('Подтверждение доступно только для MANUAL.');
      }
      if (intent.status === 'SUCCEEDED') return intent;
      if (intent.status !== 'CREATED' && intent.status !== 'PENDING') {
        throw new ConflictException('Платёж нельзя подтвердить в текущем статусе.');
      }

      const provider = this.provider('MANUAL');
      await provider.confirmIntent(intent.id, intent.providerRef);

      if (intent.wallet === 'MAIN') {
        await this.balance.credit(tx, intent.userId, intent.amountCents, 'DEPOSIT', {
          idempotencyKey: `payment:${intent.id}:main`,
          description: 'Пополнение основного баланса (Manual)',
        });
      } else {
        await this.deposit.creditAvailable(tx, intent.userId, intent.amountCents, 'TOPUP', {
          idempotencyKey: `payment:${intent.id}:deposit`,
          paymentIntentId: intent.id,
          description: 'Пополнение залога (Manual)',
        });
        await this.trust.appendHistory(tx, intent.userId, 'DEPOSIT_CHANGED', {
          deltaCents: intent.amountCents.toString(),
          reason: 'TOPUP',
          paymentIntentId: intent.id,
        });
      }

      return tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'SUCCEEDED', succeededAt: new Date() },
      });
    }, SERIALIZABLE);
  }

  async getIntent(user: AuthUser, intentId: string) {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { id: intentId } });
    if (!intent || (intent.userId !== user.id && !user.isAdmin)) {
      throw new NotFoundException('Платёж не найден.');
    }
    return intent;
  }
}
