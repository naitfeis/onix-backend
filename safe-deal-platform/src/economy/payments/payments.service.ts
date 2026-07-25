import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentProviderCode, PaymentWallet, Prisma } from '@prisma/client';
import { AuthUser } from '../../common';
import { IdempotencyService } from '../../idempotency/idempotency.service';
import { logMoneyEvent } from '../../observability/money-event';
import { PrismaService } from '../../prisma.service';
import { ManualPaymentProvider, isManualPaymentsEnabled } from './manual.provider';
import type { PaymentProvider, ProviderWebhookVerification } from './payment-provider';
import { BalanceService } from '../wallet/balance.service';
import { DepositService } from '../wallet/deposit.service';
import { TrustService } from '../trust/trust.service';

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

export type ProviderEventInput = {
  eventId: string;
  providerPaymentId: string;
  intentId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  /** Optional claims from PSP — verified against DB, never credited from. */
  claimedAmountCents?: bigint;
  claimedCurrency?: string;
};

@Injectable()
export class PaymentsService {
  private readonly providers: Map<PaymentProviderCode, PaymentProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly balance: BalanceService,
    private readonly deposit: DepositService,
    private readonly trust: TrustService,
    private readonly idempotency: IdempotencyService,
    manual: ManualPaymentProvider,
  ) {
    this.providers = new Map();
    for (const p of [manual]) {
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
      if (!user.isAdmin) {
        throw new ForbiddenException('Manual-пополнение доступно только администратору.');
      }
      if (!isManualPaymentsEnabled()) {
        throw new ForbiddenException('Manual-пополнение отключено (MANUAL_PAYMENTS_ENABLED).');
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
          currency: 'RUB',
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
    if (!user.isAdmin) {
      throw new ForbiddenException('Подтверждение Manual-платежа доступно только администратору.');
    }
    if (!isManualPaymentsEnabled()) {
      throw new ForbiddenException('Manual-пополнение отключено (MANUAL_PAYMENTS_ENABLED).');
    }
    const result = await this.idempotency.run(
      'payment.confirm',
      intentId,
      { intentId, actorId: user.id.toString(), provider: 'MANUAL' },
      () => this.settleIntentOnce(intentId, { expectProvider: 'MANUAL' }),
    );
    return result.value;
  }

  /**
   * HTTP webhook entry for real PSPs.
   * 1) provider.verifyWebhook (signature)
   * 2) idempotency by eventId
   * 3) settle from DB intent amount/currency only
   */
  async handleProviderWebhook(
    provider: PaymentProviderCode,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ) {
    const adapter = this.providers.get(provider);
    if (!adapter?.verifyWebhook) {
      throw new ForbiddenException(`Webhook для ${provider} не настроен.`);
    }
    const verified: ProviderWebhookVerification = await adapter.verifyWebhook(headers, rawBody);
    if (!verified.ok || !verified.eventId || !verified.intentId || !verified.status || !verified.providerPaymentId) {
      throw new UnauthorizedException('Неверная подпись или payload провайдера.');
    }
    return this.applyProviderEvent(provider, {
      eventId: verified.eventId,
      providerPaymentId: verified.providerPaymentId,
      intentId: verified.intentId,
      status: verified.status,
      claimedAmountCents: verified.claimedAmountCents,
      claimedCurrency: verified.claimedCurrency,
    });
  }

  /**
   * Provider webhook / callback — IdempotencyService + ledger money-path.
   * Never trusts amount/userId from payload for credit.
   */
  async applyProviderEvent(provider: PaymentProviderCode, event: ProviderEventInput) {
    const result = await this.idempotency.run(
      `payment.webhook.${provider}`,
      event.eventId,
      {
        providerPaymentId: event.providerPaymentId,
        intentId: event.intentId,
        status: event.status,
        claimedAmountCents: event.claimedAmountCents?.toString() ?? null,
        claimedCurrency: event.claimedCurrency ?? null,
      },
      async () => {
        if (event.status === 'SUCCEEDED') {
          return this.settleIntentOnce(event.intentId, {
            expectProvider: provider,
            providerPaymentId: event.providerPaymentId,
            claimedAmountCents: event.claimedAmountCents,
            claimedCurrency: event.claimedCurrency,
          });
        }
        return this.markTerminal(event.intentId, event.status, {
          expectProvider: provider,
          providerPaymentId: event.providerPaymentId,
        });
      },
    );
    logMoneyEvent('payment_webhook', {
      status: result.kind === 'replay' ? 'replay' : 'success',
      operationId: event.eventId,
      paymentId: event.intentId,
      provider,
      intentStatus: event.status,
    });
    return result.value;
  }

  private async settleIntentOnce(
    intentId: string,
    opts: {
      expectProvider: PaymentProviderCode;
      providerPaymentId?: string;
      claimedAmountCents?: bigint;
      claimedCurrency?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const intent = await tx.paymentIntent.findUnique({ where: { id: intentId } });
      if (!intent) throw new NotFoundException('Платёж не найден.');
      if (intent.provider !== opts.expectProvider) {
        throw new BadRequestException('Провайдер не совпадает с PaymentIntent.');
      }

      // Idempotent success (webhook before/after API timeout, retries).
      if (intent.status === 'SUCCEEDED') return intent;

      if (intent.status === 'CANCELED' || intent.status === 'FAILED' || intent.status === 'EXPIRED') {
        throw new ConflictException(`Нельзя зачислить платёж в статусе ${intent.status}.`);
      }
      if (intent.status !== 'CREATED' && intent.status !== 'PENDING') {
        throw new ConflictException('Платёж нельзя подтвердить в текущем статусе.');
      }

      // Optional claims — must match DB; never used as credit source.
      if (opts.claimedAmountCents !== undefined && opts.claimedAmountCents !== intent.amountCents) {
        throw new ConflictException('Сумма в webhook не совпадает с PaymentIntent.');
      }
      if (opts.claimedCurrency && opts.claimedCurrency !== intent.currency) {
        throw new ConflictException('Валюта в webhook не совпадает с PaymentIntent.');
      }

      if (opts.providerPaymentId) {
        if (intent.providerRef && intent.providerRef !== opts.providerPaymentId) {
          throw new ConflictException('providerPaymentId не совпадает с PaymentIntent.');
        }
        if (!intent.providerRef) {
          await tx.paymentIntent.update({
            where: { id: intent.id },
            data: { providerRef: opts.providerPaymentId },
          });
        }
      }

      if (intent.provider === 'MANUAL') {
        const provider = this.provider('MANUAL');
        await provider.confirmIntent(intent.id, intent.providerRef);
      }

      // Credit ONLY intent.amountCents from DB via ledger idempotency key.
      if (intent.wallet === 'MAIN') {
        await this.balance.credit(tx, intent.userId, intent.amountCents, 'DEPOSIT', {
          idempotencyKey: `payment:${intent.id}:main`,
          description: `Пополнение основного баланса (${intent.provider})`,
          actorUserId: intent.userId,
          source: 'PAYMENT_PROVIDER',
        });
      } else {
        await this.deposit.creditAvailable(tx, intent.userId, intent.amountCents, 'TOPUP', {
          idempotencyKey: `payment:${intent.id}:deposit`,
          paymentIntentId: intent.id,
          description: `Пополнение залога (${intent.provider})`,
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

  private async markTerminal(
    intentId: string,
    status: 'FAILED' | 'CANCELED',
    opts: { expectProvider: PaymentProviderCode; providerPaymentId?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const intent = await tx.paymentIntent.findUnique({ where: { id: intentId } });
      if (!intent) throw new NotFoundException('Платёж не найден.');
      if (intent.provider !== opts.expectProvider) {
        throw new BadRequestException('Провайдер не совпадает с PaymentIntent.');
      }
      if (intent.status === 'SUCCEEDED') {
        throw new ConflictException('success → failed/canceled невозможен.');
      }
      if (intent.status === status || intent.status === 'FAILED' || intent.status === 'CANCELED' || intent.status === 'EXPIRED') {
        return intent;
      }
      if (opts.providerPaymentId && !intent.providerRef) {
        await tx.paymentIntent.update({
          where: { id: intent.id },
          data: { providerRef: opts.providerPaymentId },
        });
      }
      return tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status },
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
