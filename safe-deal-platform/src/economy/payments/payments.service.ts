import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentProviderCode, PaymentWallet, Prisma, type PaymentIntent } from '@prisma/client';
import { AuthUser } from '../../common';
import { withSerializableTransaction } from '../../database/transaction-retry';
import { lockUsersInIdOrder, lockPaymentIntentForUpdate } from '../../database/money-locks';
import { IdempotencyService } from '../../idempotency/idempotency.service';
import { logMoneyEvent } from '../../observability/money-event';
import { PrismaService } from '../../prisma.service';
import { ManualPaymentProvider, isManualPaymentsEnabled } from './manual.provider';
import type { PaymentProvider, ProviderWebhookVerification } from './payment-provider';
import { BalanceService } from '../wallet/balance.service';
import type { LedgerWriteMeta } from '../wallet/ledger-write.types';
import { DepositService } from '../wallet/deposit.service';
import { TrustService } from '../trust/trust.service';

export type ProviderEventInput = {
  eventId: string;
  providerPaymentId: string;
  intentId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  /** Optional claims from PSP — verified against DB, never credited from. */
  claimedAmountCents?: bigint;
  claimedCurrency?: string;
};

const TOP_UP_CLAIM_STALE_MS = 30_000;
const TOP_UP_CLAIM_POLL_ATTEMPTS = 20;
const TOP_UP_CLAIM_POLL_MS = 25;

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
    if (dto.provider === 'MANUAL') {
      throw new ForbiddenException('MANUAL-пополнение доступно только через admin control plane.');
    }
    return this.createTopUpForUser(user.id, dto);
  }

  async createManualTopUpForAdmin(
    userId: bigint,
    dto: {
      wallet: PaymentWallet;
      amountCents: number;
      idempotencyKey: string;
    },
  ) {
    if (!isManualPaymentsEnabled()) {
      throw new ForbiddenException('Manual-пополнение отключено (MANUAL_PAYMENTS_ENABLED).');
    }
    return this.createTopUpForUser(userId, { ...dto, provider: 'MANUAL' });
  }

  private async createTopUpForUser(
    userId: bigint,
    dto: {
      wallet: PaymentWallet;
      amountCents: number;
      provider: PaymentProviderCode;
      idempotencyKey: string;
    },
  ) {
    if (dto.amountCents < 100) throw new BadRequestException('Минимальная сумма пополнения — 1 ₽.');
    const provider = this.provider(dto.provider);
    const amountCents = BigInt(dto.amountCents);

    const assertMatchingIntent = <T extends {
      userId: bigint;
      amountCents: bigint;
      wallet: PaymentWallet;
      provider: PaymentProviderCode;
    }>(existing: T): T => {
      if (
        existing.userId !== userId
        || existing.amountCents !== amountCents
        || existing.wallet !== dto.wallet
        || existing.provider !== dto.provider
      ) {
        throw new ConflictException('Ключ идемпотентности уже использован.');
      }
      return existing;
    };

    let claim: PaymentIntent;
    let ownsClaim = false;
    try {
      claim = await withSerializableTransaction(this.prisma, (tx) =>
        tx.paymentIntent.create({
          data: {
            userId,
            wallet: dto.wallet,
            provider: dto.provider,
            amountCents,
            currency: 'RUB',
            status: 'CREATED',
            idempotencyKey: dto.idempotencyKey,
          },
        }));
      ownsClaim = true;
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const existing = await this.prisma.paymentIntent.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (!existing) throw error;
      claim = existing;
    }

    assertMatchingIntent(claim);
    if (!ownsClaim && claim.status === 'CREATED') {
      const observed = await this.observeOrTakeOverTopUpClaim(claim, assertMatchingIntent);
      claim = observed.intent;
      ownsClaim = observed.ownsClaim;
    }
    if (!ownsClaim || claim.status !== 'CREATED') return claim;

    // This is deliberately outside every retryable transaction callback.
    // A stale-owner recovery may repeat it after a crash, so the provider MUST
    // deduplicate the stable idempotency key required by PaymentProvider.
    const created = await provider.createIntent({
      userId,
      wallet: dto.wallet,
      amountCents,
      idempotencyKey: dto.idempotencyKey,
    });

    const finalized = await this.prisma.paymentIntent.updateMany({
      where: {
        id: claim.id,
        status: 'CREATED',
        updatedAt: claim.updatedAt,
      },
      data: {
        status: created.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'PENDING',
        providerRef: created.providerRef,
        metadata: (created.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        succeededAt: created.status === 'SUCCEEDED' ? new Date() : undefined,
      },
    });
    const current = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (!current) throw new NotFoundException('Платёж не найден после создания.');
    // A stale takeover can fence an earlier owner. Provider-side idempotency
    // makes both recovery calls resolve to the same provider intent.
    if (finalized.count === 0) return assertMatchingIntent(current);
    return current;
  }

  private isUniqueConflict(error: unknown): boolean {
    return Boolean(
      error
      && typeof error === 'object'
      && (error as { code?: unknown }).code === 'P2002',
    );
  }

  private async observeOrTakeOverTopUpClaim(
    initial: PaymentIntent,
    assertMatching: (intent: PaymentIntent) => PaymentIntent,
  ): Promise<{ intent: PaymentIntent; ownsClaim: boolean }> {
    let intent = initial;
    for (let attempt = 0; attempt < TOP_UP_CLAIM_POLL_ATTEMPTS; attempt += 1) {
      if (intent.status !== 'CREATED') return { intent, ownsClaim: false };
      if (Date.now() - intent.updatedAt.getTime() >= TOP_UP_CLAIM_STALE_MS) {
        const claimedAt = new Date();
        const takeover = await this.prisma.paymentIntent.updateMany({
          where: { id: intent.id, status: 'CREATED', updatedAt: intent.updatedAt },
          data: { updatedAt: claimedAt },
        });
        if (takeover.count === 1) {
          return {
            intent: { ...intent, updatedAt: claimedAt },
            ownsClaim: true,
          };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, TOP_UP_CLAIM_POLL_MS));
      const current = await this.prisma.paymentIntent.findUnique({
        where: { idempotencyKey: intent.idempotencyKey },
      });
      if (!current) throw new NotFoundException('Заявка на платёж не найдена.');
      intent = assertMatching(current);
    }
    return { intent, ownsClaim: false };
  }

  async confirmManualForAdmin(intentId: string, adminUserId: bigint) {
    if (!isManualPaymentsEnabled()) {
      throw new ForbiddenException('Manual-пополнение отключено (MANUAL_PAYMENTS_ENABLED).');
    }
    const result = await this.idempotency.runTransactional(
      'payment.confirm',
      intentId,
      { intentId, adminUserId: adminUserId.toString(), provider: 'MANUAL' },
      (tx) => this.settleIntentInTx(tx, intentId, { expectProvider: 'MANUAL' }),
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
    const result = await this.idempotency.runTransactional(
      `payment.webhook.${provider}`,
      event.eventId,
      {
        providerPaymentId: event.providerPaymentId,
        intentId: event.intentId,
        status: event.status,
        claimedAmountCents: event.claimedAmountCents?.toString() ?? null,
        claimedCurrency: event.claimedCurrency ?? null,
      },
      async (tx) => {
        if (event.status === 'SUCCEEDED') {
          return this.settleIntentInTx(tx, event.intentId, {
            expectProvider: provider,
            providerPaymentId: event.providerPaymentId,
            claimedAmountCents: event.claimedAmountCents,
            claimedCurrency: event.claimedCurrency,
          });
        }
        return this.markTerminalInTx(tx, event.intentId, event.status, {
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

  private async settleIntentInTx(
    tx: Prisma.TransactionClient,
    intentId: string,
    opts: {
      expectProvider: PaymentProviderCode;
      providerPaymentId?: string;
      claimedAmountCents?: bigint;
      claimedCurrency?: string;
    },
  ) {
      await lockPaymentIntentForUpdate(tx, intentId);
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
      await lockUsersInIdOrder(tx, [intent.userId]);

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
        const depositMeta: LedgerWriteMeta = {
          idempotencyKey: `payment:${intent.id}:main`,
          description: `Пополнение основного баланса (${intent.provider})`,
          actorUserId: intent.userId,
          source: 'PAYMENT_PROVIDER',
          fundKind: 'USER_OWNED',
        };
        await this.balance.credit(tx, intent.userId, intent.amountCents, 'DEPOSIT', depositMeta);
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
  }

  private async markTerminalInTx(
    tx: Prisma.TransactionClient,
    intentId: string,
    status: 'FAILED' | 'CANCELED',
    opts: { expectProvider: PaymentProviderCode; providerPaymentId?: string },
  ) {
    await lockPaymentIntentForUpdate(tx, intentId);
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
  }

  async getIntent(user: AuthUser, intentId: string) {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { id: intentId } });
    if (!intent || intent.userId !== user.id) {
      throw new NotFoundException('Платёж не найден.');
    }
    return intent;
  }
}
