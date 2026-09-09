import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
  Optional, UnauthorizedException,
} from '@nestjs/common';
import { PaymentProviderCode, PaymentWallet, Prisma, type PaymentIntent } from '@prisma/client';
import { AuthUser } from '../../common';
import { withSerializableTransaction } from '../../database/transaction-retry';
import { lockUsersInIdOrder, lockPaymentIntentForUpdate, lockProductForUpdate } from '../../database/money-locks';
import { IdempotencyService } from '../../idempotency/idempotency.service';
import { logMoneyEvent } from '../../observability/money-event';
import { PrismaService } from '../../prisma.service';
import { ManualPaymentProvider, isManualPaymentsEnabled } from './manual.provider';
import { TinkoffAcquiringProvider, tinkoffCredentials } from './tinkoff.provider';
import type { PaymentProvider, ProviderWebhookVerification } from './payment-provider';
import { BalanceService } from '../wallet/balance.service';
import type { LedgerWriteMeta } from '../wallet/ledger-write.types';
import { DepositService } from '../wallet/deposit.service';
import { TrustService } from '../trust/trust.service';
import { spendableBalanceCents } from '../wallet/sale-proceeds-hold';
import { releaseProductStock, reserveProductStock } from '../wallet/product-stock';
import { CHECKOUT_SETTLEMENT, type CheckoutSettlementPort } from '../../checkout-settlement';
import {
  checkoutAcquiringFeeBps,
  checkoutBindFingerprint,
  computeCheckoutExternalCents,
  parsePaymentCheckoutMetadata,
} from '../../payments-checkout.types';

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
    tinkoff: TinkoffAcquiringProvider,
    @Optional() @Inject(CHECKOUT_SETTLEMENT) private readonly checkout?: CheckoutSettlementPort,
  ) {
    this.providers = new Map();
    this.providers.set(manual.code, manual);
    if (tinkoff.isConfigured()) {
      this.providers.set('YOOKASSA', tinkoff);
      this.providers.set('CARD', tinkoff);
    }
  }

  paymentMethodsPublic() {
    const live = tinkoffCredentials() != null;
    return {
      sbp: live,
      card: live,
      sandbox: (process.env.TINKOFF_SANDBOX ?? 'true').trim() !== 'false',
    };
  }

  private provider(code: PaymentProviderCode): PaymentProvider {
    const p = this.providers.get(code);
    if (p) return p;
    if (code === 'YOOKASSA' || code === 'CARD') {
      throw new ForbiddenException(
        'СБП и карта: задайте TINKOFF_TERMINAL_KEY и TINKOFF_PASSWORD (sandbox Т-Банка) в переменных API.',
      );
    }
    throw new ForbiddenException(`Платёжный провайдер ${code} ещё не подключён.`);
  }

  async createTopUp(
    user: AuthUser,
    dto: {
      wallet: PaymentWallet;
      amountCents: number;
      provider: PaymentProviderCode;
      idempotencyKey: string;
      checkout?: {
        productId: string;
        quantity: number;
        purchaseIdempotencyKey: string;
      };
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
      checkout?: {
        productId: string;
        quantity: number;
        purchaseIdempotencyKey: string;
      };
    },
  ) {
    if (dto.amountCents < 100) throw new BadRequestException('Минимальная сумма пополнения — 1 ₽.');
    if (dto.checkout) {
      if (dto.wallet !== 'MAIN') {
        throw new BadRequestException('Checkout-платёж возможен только на основной баланс.');
      }
      if (!dto.checkout.productId?.trim() || !dto.checkout.purchaseIdempotencyKey?.trim()) {
        throw new BadRequestException('Некорректные параметры checkout.');
      }
      if (!Number.isInteger(dto.checkout.quantity) || dto.checkout.quantity < 1 || dto.checkout.quantity > 10_000) {
        throw new BadRequestException('Некорректное количество checkout.');
      }
    }
    const provider = this.provider(dto.provider);
    const amountCents = BigInt(dto.amountCents);

    const assertMatchingIntent = <T extends {
      userId: bigint;
      amountCents: bigint;
      wallet: PaymentWallet;
      provider: PaymentProviderCode;
      metadata?: unknown;
    }>(existing: T): T => {
      if (
        existing.userId !== userId
        || existing.amountCents !== amountCents
        || existing.wallet !== dto.wallet
        || existing.provider !== dto.provider
      ) {
        throw new ConflictException('Ключ идемпотентности уже использован.');
      }
      const existingCheckout = parsePaymentCheckoutMetadata(existing.metadata);
      const wantBind = dto.checkout
        ? {
          productId: dto.checkout.productId.trim(),
          quantity: dto.checkout.quantity,
          purchaseIdempotencyKey: dto.checkout.purchaseIdempotencyKey,
        }
        : null;
      if (checkoutBindFingerprint(existingCheckout) !== checkoutBindFingerprint(wantBind)) {
        throw new ConflictException('Ключ идемпотентности уже использован.');
      }
      return existing;
    };

    let claim: PaymentIntent;
    let ownsClaim = false;
    try {
      claim = await withSerializableTransaction(this.prisma, async (tx) => {
        let metadata: Prisma.InputJsonValue | undefined;
        if (dto.checkout) {
          const productId = dto.checkout.productId.trim();
          const quantity = dto.checkout.quantity;
          await lockProductForUpdate(tx, productId);
          const product = await tx.product.findUnique({ where: { id: productId } });
          if (
            !product
            || product.status !== 'ACTIVE'
            || product.expiresAt <= new Date()
            || product.quantity < quantity
          ) {
            throw new ConflictException('Товар недоступен.');
          }
          if (product.sellerId === userId) {
            throw new BadRequestException('Нельзя купить собственный товар.');
          }
          await lockUsersInIdOrder(tx, [userId, product.sellerId]);
          const totalAmountCents = product.priceCents * BigInt(quantity);
          const spendable = await spendableBalanceCents(tx, this.balance, userId);
          const feeBps = checkoutAcquiringFeeBps(dto.provider);
          const quote = computeCheckoutExternalCents(totalAmountCents, spendable, feeBps);
          if (quote.externalCents < 100n) {
            throw new BadRequestException('Внешний платёж не требуется — оплатите с баланса.');
          }
          if (amountCents !== quote.externalCents) {
            throw new BadRequestException(
              `Сумма оплаты устарела. Ожидается ${quote.externalCents.toString()} коп. Обновите экран покупки.`,
            );
          }
          await reserveProductStock(tx, product.id, quantity);
          metadata = {
            checkout: {
              productId,
              quantity,
              purchaseIdempotencyKey: dto.checkout.purchaseIdempotencyKey,
              unitPriceCents: product.priceCents.toString(),
              totalAmountCents: totalAmountCents.toString(),
              stockReserved: true,
              externalFeeCents: quote.feeCents.toString(),
            },
          };
        }
        return tx.paymentIntent.create({
          data: {
            userId,
            wallet: dto.wallet,
            provider: dto.provider,
            amountCents,
            currency: 'RUB',
            status: 'CREATED',
            idempotencyKey: dto.idempotencyKey,
            ...(metadata ? { metadata } : {}),
          },
        });
      });
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
      metadata: { payWay: dto.provider === 'CARD' ? 'card' : 'sbp' },
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
        metadata: {
          ...(claim.metadata && typeof claim.metadata === 'object'
            ? claim.metadata as Prisma.InputJsonObject
            : {}),
          payWay: dto.provider === 'CARD' ? 'card' : 'sbp',
        } as Prisma.InputJsonValue,
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
    const stored = await this.prisma.paymentIntent.findUnique({
      where: { id: verified.intentId },
      select: { provider: true },
    });
    const settleProvider = stored?.provider ?? provider;
    return this.applyProviderEvent(settleProvider, {
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

      const checkout = parsePaymentCheckoutMetadata(intent.metadata);
      // Canonical lock order: Product (if checkout) → Users ascending.
      if (checkout) {
        await lockProductForUpdate(tx, checkout.productId);
        const product = await tx.product.findUnique({ where: { id: checkout.productId } });
        if (!product) throw new ConflictException('Товар недоступен.');
        await lockUsersInIdOrder(tx, [intent.userId, product.sellerId]);
      } else {
        await lockUsersInIdOrder(tx, [intent.userId]);
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

      // Credit ONLY intent amount from DB. Checkout acquiring fee is not credited to the user
      // (covers PSP cost); purchase debit uses frozen product total.
      if (intent.wallet === 'MAIN') {
        const feeCents = checkout ? BigInt(checkout.externalFeeCents) : 0n;
        const creditCents = intent.amountCents > feeCents ? intent.amountCents - feeCents : 0n;
        if (creditCents > 0n) {
          const depositMeta: LedgerWriteMeta = {
            idempotencyKey: `payment:${intent.id}:main`,
            description: `Пополнение основного баланса (${intent.provider})`,
            actorUserId: intent.userId,
            source: 'PAYMENT_PROVIDER',
            fundKind: 'USER_OWNED',
          };
          await this.balance.credit(tx, intent.userId, creditCents, 'DEPOSIT', depositMeta);
        }

        if (checkout) {
          if (!this.checkout) {
            throw new ConflictException('Checkout-покупка недоступна: модуль сделок не подключён.');
          }
          await this.checkout.purchaseInTx(
            tx,
            { id: intent.userId } as AuthUser,
            checkout.productId,
            checkout.purchaseIdempotencyKey,
            checkout.quantity,
            {
              locksHeld: true,
              stockPreReserved: checkout.stockReserved,
              frozenUnitPriceCents: BigInt(checkout.unitPriceCents),
            },
          );
          // Stock consumed by order — clear reservation flag so expire/fail won't re-increment.
          if (checkout.stockReserved) {
            await this.clearCheckoutStockFlag(tx, intent.id, intent.metadata);
          }
        }
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

  private async releaseCheckoutReservation(
    tx: Prisma.TransactionClient,
    intent: { id: string; metadata: unknown },
  ): Promise<void> {
    const checkout = parsePaymentCheckoutMetadata(intent.metadata);
    if (!checkout?.stockReserved) return;
    await lockProductForUpdate(tx, checkout.productId);
    await releaseProductStock(tx, checkout.productId, checkout.quantity);
    await this.clearCheckoutStockFlag(tx, intent.id, intent.metadata);
  }

  private async clearCheckoutStockFlag(
    tx: Prisma.TransactionClient,
    intentId: string,
    metadata: unknown,
  ): Promise<void> {
    if (!metadata || typeof metadata !== 'object') return;
    const next = {
      ...(metadata as Record<string, unknown>),
      checkout: {
        ...((metadata as { checkout?: Record<string, unknown> }).checkout ?? {}),
        stockReserved: false,
      },
    };
    await tx.paymentIntent.update({
      where: { id: intentId },
      data: { metadata: next as Prisma.InputJsonValue },
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
    await this.releaseCheckoutReservation(tx, intent);
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
