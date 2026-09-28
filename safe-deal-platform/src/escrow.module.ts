import {
  BadRequestException, Body, ConflictException, Controller, Get, Header, Injectable,
  Module, NotFoundException, Optional, Param, Post, Query, forwardRef,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { ensurePairChat } from './chat-pair';
import { AuthUser, CurrentUser, canActAsSupport, parseId } from './common';
import { DistributedRateLimiter } from './rate-limit';
import { assertUsersNotBlocked } from './user-block';
import { withSerializableTransaction } from './database/transaction-retry';
import {
  lockOrderForUpdate,
  lockProductForUpdate,
  lockUsersInIdOrder,
} from './database/money-locks';
import { decryptDeliverySecret } from './delivery-crypto';
import {
  deliverTelegramAfterCommit,
  notificationOrderId,
} from './domain-notify';
import { EconomyModule } from './economy/economy.module';
import { RiskEngineService } from './risk/risk-engine.service';
import { RiskModule } from './risk/risk.module';
import { BalanceService } from './economy/wallet/balance.service';
import { ClawbackService } from './economy/wallet/clawback.service';
import { assertSpendableBalance, warrantyWindowOpenForOrder } from './economy/wallet/sale-proceeds-hold';
import { reserveProductStock } from './economy/wallet/product-stock';
import { SupportModule, SupportService } from './support.module';
import { saleKindFromSubcategory } from './economy/wallet/fund-provenance';
import type { LedgerWriteMeta } from './economy/wallet/ledger-write.types';
import { LockService } from './economy/wallet/lock.service';
import { PrismaService } from './prisma.service';
import { RealtimeBus } from './realtime/realtime-bus.service';
import { RealtimeModule } from './realtime/realtime.module';
import { buildLightDisputeCard } from './dispute-card';
import { computeSaleAmounts } from './pricing';
import { dealPartySelect, dealProductSelect, dealWarrantySelect } from './query-selects';
import { dealDto } from './response';
import { hideReviewsForOrder } from './marketplace/review-aggregate';

function decodeOrderListCursor(
  raw: string | undefined,
  sort: string,
): Prisma.OrderWhereInput | null {
  if (!raw?.trim()) return null;
  const sep = raw.indexOf('|');
  if (sep <= 0) return null;
  const left = raw.slice(0, sep);
  const idRaw = raw.slice(sep + 1).trim();
  if (!/^\d+$/.test(idRaw)) return null;
  const id = BigInt(idRaw);
  if (sort === 'expensive' || sort === 'cheap') {
    if (!/^\d+$/.test(left)) return null;
    const totalAmountCents = BigInt(left);
    if (sort === 'cheap') {
      return {
        OR: [
          { totalAmountCents: { gt: totalAmountCents } },
          { AND: [{ totalAmountCents }, { id: { gt: id } }] },
        ],
      };
    }
    return {
      OR: [
        { totalAmountCents: { lt: totalAmountCents } },
        { AND: [{ totalAmountCents }, { id: { lt: id } }] },
      ],
    };
  }
  const createdAt = new Date(left);
  if (!Number.isFinite(createdAt.getTime())) return null;
  if (sort === 'oldest') {
    return {
      OR: [
        { createdAt: { gt: createdAt } },
        { AND: [{ createdAt }, { id: { gt: id } }] },
      ],
    };
  }
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { AND: [{ createdAt }, { id: { lt: id } }] },
    ],
  };
}
import { CHECKOUT_SETTLEMENT, type PurchaseInTxOptions } from './checkout-settlement';
import {
  ADMIN_COMPLETE_FROM,
  BUYER_COMPLETE_FROM,
  OPEN_SUPPORT_TICKET_STATUSES,
  REFUND_FROM,
  SELLER_DELIVER_FROM,
  assertNotTerminalForMutation,
  assertOrderMoneySplit,
  assertStatusIn,
} from './order-state-machine';

class PurchaseDto {
  @IsString() @Length(16, 100) idempotencyKey!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) quantity = 1;
}
class ReasonDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsString() @Length(16, 100) idempotencyKey!: string;
}
class SellerRefundDto {
  @IsString() @MaxLength(1000) reason!: string;
  @IsString() @Length(16, 100) idempotencyKey!: string;
}
class OrderQuery {
  /** newest | oldest | expensive | cheap — marketplace-style sorts kept for API compat */
  @IsOptional() @IsIn(['newest', 'oldest', 'expensive', 'cheap']) sort?: string;
  /** all (omit) | open | completed | active | canceled | dispute | archive */
  @IsOptional() @IsIn(['open', 'active', 'completed', 'canceled', 'dispute', 'archive']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  /** Keyset: opaque `createdAt|id` or `totalAmountCents|id` depending on sort. */
  @IsOptional() @IsString() @Length(3, 120) cursor?: string;
}

/**
 * Escrow state machine — see order-state-machine.ts (single source of truth).
 * Money: buyer debit on purchase (PURCHASE_HOLD); seller credit only on COMPLETED (SALE_PAYOUT).
 * PAYMENT_HOLD → CANCELED: support/admin only (buyer opens support instead of cancel).
 * COMPLETED → REFUNDED: clawback totalAmount from seller (never negative ledger).
 * Admin MUST NOT complete from PAYMENT_HOLD (no payout without deliver/dispute).
 */
@Injectable()
export class EscrowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balance: BalanceService,
    private readonly clawbacks: ClawbackService,
    private readonly locks: LockService,
    private readonly realtime: RealtimeBus,
    private readonly support: SupportService,
    @Optional() private readonly risk?: RiskEngineService,
  ) {}

  private emitOrderUpdated(order: {
    id: bigint;
    status: string;
    buyerId: bigint;
    sellerId: bigint;
    chatId?: string | null;
  }, opts?: { soundUserIds?: bigint[] }): void {
    this.realtime.publish({
      kind: 'order.updated',
      orderId: order.id.toString(),
      status: order.status,
      ...(order.chatId ? { chatId: order.chatId } : {}),
      recipientUserIds: [order.buyerId, order.sellerId],
      ...(opts?.soundUserIds?.length ? { soundUserIds: opts.soundUserIds } : {}),
    });
  }

  private emitProductChanged(product: { id: string; status: string; quantity: number }, opts?: { created?: boolean }): void {
    this.realtime.publish({
      kind: 'product.changed',
      productId: product.id,
      status: product.status,
      quantity: product.quantity,
      ...(opts?.created ? { created: true } : {}),
    });
  }

  async list(user: AuthUser, query: OrderQuery = {}) {
    const statusWhere: Prisma.OrderWhereInput =
      query.status === 'open' || query.status === 'active'
        ? { status: { in: ['PAYMENT_HOLD', 'DELIVERING', 'DISPUTE'] } } :
      query.status === 'completed' ? { status: 'COMPLETED' } :
      query.status === 'canceled' ? { status: 'CANCELED' } :
      query.status === 'dispute' ? { status: 'DISPUTE' } :
      query.status === 'archive' ? { status: { in: ['CANCELED', 'REFUNDED'] } } :
      {};
    const sort = query.sort ?? 'newest';
    const orderBy: Prisma.OrderOrderByWithRelationInput[] =
      sort === 'oldest' ? [{ createdAt: 'asc' }, { id: 'asc' }] :
      sort === 'expensive' ? [{ totalAmountCents: 'desc' }, { id: 'desc' }] :
      sort === 'cheap' ? [{ totalAmountCents: 'asc' }, { id: 'asc' }] :
      [{ createdAt: 'desc' }, { id: 'desc' }];
    const take = Math.min(Math.max(query.limit ?? 100, 1), 100);
    const cursorWhere = decodeOrderListCursor(query.cursor, sort);
    const orders = await this.prisma.order.findMany({
      relationLoadStrategy: 'join',
      where: {
        OR: [{ buyerId: user.id }, { sellerId: user.id }],
        ...statusWhere,
        ...(cursorWhere ?? {}),
      },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        totalAmountCents: true,
        status: true,
        createdAt: true,
        ...dealWarrantySelect,
        product: { select: dealProductSelect },
        buyer: { select: dealPartySelect },
        seller: { select: dealPartySelect },
        reviews: { select: { authorId: true } },
        chat: { select: { id: true } },
        supportTickets: {
          select: { id: true, status: true, chatId: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy,
      take,
    });
    return orders.map((order) => {
      const ticket = order.supportTickets[0]
        ? { ...order.supportTickets[0], chatId: order.supportTickets[0].chatId ?? order.chat?.id ?? '' }
        : null;
      const dispute = buildLightDisputeCard({
        orderId: order.id,
        status: order.status,
        ticket,
      });
      const supportTickets = order.supportTickets.map((t) => ({
        ...t,
        chatId: t.chatId ?? undefined,
      }));
      return dealDto({ ...order, supportTickets, dispute }, user);
    });
  }

  /**
   * Canonical purchase entry — Marketplace / Favorites / Public Profile product card
   * all call POST /orders/product/:productId → this method only.
   */
  /**
   * Core purchase mutation — callable inside an existing money transaction (e.g. payment settle).
   */
  async purchaseInTx(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    productId: string,
    key: string,
    quantity: number,
    opts?: PurchaseInTxOptions,
  ) {
    const existing = await tx.order.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (existing.buyerId !== user.id || existing.productId !== productId || existing.quantity !== quantity) {
        throw new ConflictException('Ключ идемпотентности уже использован для другого запроса.');
      }
      return {
        order: existing,
        notifyIds: await this.pendingOrderNotifyIds(tx, existing.id, [existing.buyerId, existing.sellerId]),
      };
    }
    if (!opts?.locksHeld) {
      await lockProductForUpdate(tx, productId);
    }
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || product.expiresAt <= new Date()) {
      throw new ConflictException('Товар недоступен.');
    }
    if (product.sellerId === user.id) throw new BadRequestException('Нельзя купить собственный товар.');
    await assertUsersNotBlocked(
      tx,
      user.id,
      product.sellerId,
      'Покупка недоступна: пользователь в чёрном списке.',
    );
    if (product.priceCents < 0n) throw new BadRequestException('Некорректная цена товара.');
    const unitPrice = opts?.frozenUnitPriceCents ?? product.priceCents;
    if (opts?.frozenUnitPriceCents != null && product.priceCents !== opts.frozenUnitPriceCents) {
      throw new ConflictException('Цена лота изменилась. Создайте оплату заново.');
    }
    if (!opts?.locksHeld) {
      await lockUsersInIdOrder(tx, [user.id, product.sellerId]);
    }
    const totalAmountCents = unitPrice * BigInt(quantity);
    const { feeCents, payoutCents } = computeSaleAmounts(totalAmountCents);
    assertOrderMoneySplit({ totalAmountCents, feeCents, payoutCents });
    let stockAfterQty: number;
    if (opts?.stockPreReserved) {
      // Stock already decremented at PaymentIntent create; product may be ACTIVE/RESERVED/SOLD_OUT.
      if (!['ACTIVE', 'RESERVED', 'SOLD_OUT'].includes(product.status)) {
        throw new ConflictException('Товар недоступен.');
      }
      stockAfterQty = product.quantity;
    } else {
      if (product.status !== 'ACTIVE' || product.quantity < quantity) {
        throw new ConflictException('Товар недоступен.');
      }
      const reserved = await reserveProductStock(tx, product.id, quantity);
      stockAfterQty = reserved.quantityAfter;
    }
    if (totalAmountCents > 0n) {
      await assertSpendableBalance(
        tx,
        this.balance,
        user.id,
        totalAmountCents,
        'Недостаточно средств для покупки (часть баланса заблокирована гарантией или возвратом).',
      );
      await this.balance.debit(tx, user.id, totalAmountCents, 'PURCHASE_HOLD', {
        idempotencyKey: `order:${key}:hold`,
        description: 'Покупки',
        actorUserId: user.id,
        source: 'SYSTEM',
      });
    }
    const chat = await ensurePairChat(tx, user.id, product.sellerId);
    const chatId = chat.id;
    const created = await tx.order.create({
      data: {
        productId, buyerId: user.id, sellerId: product.sellerId,
        totalAmountCents, feeCents, payoutCents, quantity,
        status: 'PAYMENT_HOLD', idempotencyKey: key,
        chatId,
        transitions: { create: {
          from: 'PENDING', to: 'PAYMENT_HOLD', actorId: user.id,
          idempotencyKey: `order:${key}:create`,
        } },
      },
      include: { chat: true },
    });
    await tx.ledgerEntry.updateMany({
      where: { idempotencyKey: `order:${key}:hold` },
      data: { orderId: created.id },
    });
    await tx.message.create({
      data: {
        chatId,
        kind: 'SYSTEM',
        senderId: null,
        text: [
          `Заказ #${created.id} создан.`,
          `Товар: «${product.title}»`,
          '',
          'Не подтверждайте получение товара,',
          'пока полностью его не проверите.',
          '',
          'При любых проблемах',
          'нажмите «Обратиться в поддержку».',
        ].join('\n'),
      },
    });
    await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });

    // Auto-delivery: one secret per listing — only when the last unit sells (stockAfterQty === 0).
    const isLastUnit = stockAfterQty === 0;
    if (
      isLastUnit
      && product.autoDeliver
      && product.deliveryCiphertext
      && product.deliveryIv
      && !product.deliveryConsumedAt
    ) {
      let payload: string;
      try {
        payload = decryptDeliverySecret(product.deliveryCiphertext, product.deliveryIv);
      } catch {
        throw new BadRequestException(
          'Автовыдача недоступна: ошибка расшифровки. Проверьте PRODUCT_DELIVERY_KEY на сервере.',
        );
      }
      if (payload.length > 4200) {
        throw new BadRequestException('Текст автовыдачи слишком длинный для выдачи в чат.');
      }
      await tx.message.create({
        data: {
          chatId,
          kind: 'SYSTEM',
          senderId: null,
          text: 'Товар выдан автоматически (автовыдача).',
        },
      });
      await tx.message.create({
        data: {
          chatId,
          kind: 'SYSTEM',
          senderId: null,
          visibleToUserId: user.id,
          text: `Автовыдача товара:\n\n${payload}`,
        },
      });
      await tx.product.update({
        where: { id: product.id },
        data: {
          deliveryCiphertext: null,
          deliveryIv: null,
          deliveryConsumedAt: new Date(),
        },
      });
      await tx.order.update({
        where: { id: created.id },
        data: { status: 'DELIVERING' },
      });
      await tx.orderTransition.create({
        data: {
          orderId: created.id,
          from: 'PAYMENT_HOLD',
          to: 'DELIVERING',
          actorId: null,
          idempotencyKey: `order:${key}:auto-deliver`,
          reason: 'AUTO_DELIVER',
        },
      });
    }

    const sellerNote = await this.notify(tx, product.sellerId, 'ORDER_UPDATE', 'Новая покупка', `Куплен товар «${product.title}»`, created.id);
    const buyerNote = await this.notify(
      tx,
      user.id,
      'ORDER_UPDATE',
      'Заказ создан',
      'Оплата в сейфе ONIX. Проверьте товар перед подтверждением.',
      created.id,
    );
    await this.audit(tx, user.id, 'ORDER_PURCHASE', created.id, { productId });
    return { order: created, notifyIds: [sellerNote.id, buyerNote.id] };
  }

  async purchase(user: AuthUser, productId: string, key: string, quantity: number) {
    const productPeek = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { priceCents: true },
    });
    if (productPeek && this.risk) {
      await this.risk.assertPurchaseAllowed(user.id, productPeek.priceCents * BigInt(quantity));
    }
    const { order, notifyIds } = await withSerializableTransaction(this.prisma, async (tx) =>
      this.purchaseInTx(tx, user, productId, key, quantity));

    deliverTelegramAfterCommit(this.prisma, notifyIds);
    const live = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { id: true, status: true, buyerId: true, sellerId: true, chatId: true },
    });
    if (live) {
      this.emitOrderUpdated(live, { soundUserIds: [live.sellerId] });
      this.realtime.publish({
        kind: 'notification',
        userId: live.sellerId,
        id: `order-paid-${live.id.toString()}`,
        title: 'Новая покупка',
        body: 'Покупатель оплатил заказ.',
        createdAt: new Date().toISOString(),
        data: {
          orderId: live.id.toString(),
          ...(live.chatId ? { chatId: live.chatId } : {}),
        },
      });
    }
    const productLive = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true, quantity: true },
    });
    if (productLive) this.emitProductChanged(productLive);

    return this.one(user, order.id);
  }

  async deliver(user: AuthUser, id: bigint, key: string) {
    await this.transition(id, user, SELLER_DELIVER_FROM, 'DELIVERING', 'seller', key);
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      select: { id: true, status: true, buyerId: true, sellerId: true, chatId: true },
    });
    this.emitOrderUpdated(order);
    return this.one(user, id);
  }

  async complete(user: AuthUser, id: bigint, key: string) {
    const notifyIds = await this.finishAsCompleted(user, id, key, {
      allowedFrom: [...BUYER_COMPLETE_FROM],
      requireBuyer: true,
    });
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      select: { id: true, status: true, buyerId: true, sellerId: true, chatId: true },
    });
    this.emitOrderUpdated(order);
    deliverTelegramAfterCommit(this.prisma, notifyIds);
    return this.one(user, id);
  }

  /** Support/admin: release escrow to seller — full spectrum including PAYMENT_HOLD. */
  async completeByAdmin(actor: AuthUser, id: bigint, reason?: string) {
    if (!canActAsSupport(actor)) {
      throw new BadRequestException('Подтвердить сделку продавцу может только поддержка.');
    }
    const key = `order:${id}:admin-complete`;
    const notifyIds = await this.finishAsCompleted(actor, id, key, {
      allowedFrom: [...ADMIN_COMPLETE_FROM],
      requireBuyer: false,
      supportReason: reason?.trim() ? `Администратор: ${reason.trim()}` : 'Администратор',
    });
    await this.prisma.supportTicket.updateMany({
      where: { orderId: id, status: { in: [...OPEN_SUPPORT_TICKET_STATUSES] } },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      select: {
        id: true, buyerId: true, sellerId: true, totalAmountCents: true, status: true, createdAt: true,
        ...dealWarrantySelect,
        product: { select: dealProductSelect },
        buyer: { select: dealPartySelect },
        seller: { select: dealPartySelect },
        reviews: { select: { authorId: true } },
        chat: { select: { id: true } },
      },
    });
    if (order.chat?.id) {
      await this.prisma.message.create({
        data: {
          chatId: order.chat.id,
          kind: 'SYSTEM',
          senderId: null,
          text: [
            `Решение поддержки по заказу #${id}: подтверждение продавцу.`,
            'Деньги из сейфа ONIX зачислены продавцу (за вычетом комиссии площадки 5%).',
            'Сделка завершена.',
          ].join('\n'),
        },
      });
      await this.prisma.chat.update({ where: { id: order.chat.id }, data: { updatedAt: new Date() } });
    }
    deliverTelegramAfterCommit(this.prisma, notifyIds);
    this.emitOrderUpdated({
      id: order.id,
      status: order.status,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      chatId: order.chat?.id,
    });
    return dealDto(order, actor);
  }

  private async finishAsCompleted(
    actor: AuthUser,
    id: bigint,
    key: string,
    opts: { allowedFrom: OrderStatus[]; requireBuyer: boolean; supportReason?: string },
  ): Promise<bigint[]> {
    return withSerializableTransaction(this.prisma, async (tx) => {
      const replay = await tx.orderTransition.findUnique({ where: { idempotencyKey: key } });
      if (replay) {
        if (replay.orderId !== id || replay.to !== 'COMPLETED') {
          throw new ConflictException('Ключ идемпотентности уже использован для другого действия.');
        }
        const existing = await tx.order.findUniqueOrThrow({ where: { id } });
        return this.pendingOrderNotifyIds(tx, id, [existing.sellerId]);
      }
      await lockOrderForUpdate(tx, id);
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Сделка не найдена.');
      if (opts.requireBuyer && order.buyerId !== actor.id) {
        throw new BadRequestException('Только покупатель подтверждает получение.');
      }
      if (order.status === 'COMPLETED') {
        return this.pendingOrderNotifyIds(tx, id, [order.sellerId]);
      }
      assertNotTerminalForMutation(order.status, 'complete');
      assertStatusIn(order.status, opts.allowedFrom, 'complete');
      assertOrderMoneySplit(order);
      if (opts.requireBuyer) {
        const openTicket = await tx.supportTicket.findFirst({
          where: { orderId: id, status: { in: [...OPEN_SUPPORT_TICKET_STATUSES] } },
          select: { id: true },
        });
        if (openTicket) {
          throw new ConflictException('Пока открыто обращение в поддержку, подтвердить получение нельзя.');
        }
      }
      await lockProductForUpdate(tx, order.productId);
      await lockUsersInIdOrder(tx, [order.buyerId, order.sellerId]);
      const changed = await tx.order.updateMany({
        where: { id, status: { in: opts.allowedFrom } },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (!changed.count) {
        throw new ConflictException('Сделку нельзя завершить в текущем статусе.');
      }
      const existingPayout = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: `order:${id}:payout` } });
      if (!existingPayout) {
        // 0 ₽ orders: skip ledger credit (BalanceService rejects amount ≤ 0).
        if (order.payoutCents > 0n) {
          const productForProvenance = await tx.product.findUniqueOrThrow({
            where: { id: order.productId },
            select: { subcategory: true },
          });
          const payoutMeta: LedgerWriteMeta = {
            idempotencyKey: `order:${id}:payout`,
            orderId: id,
            description: opts.requireBuyer ? 'Выплата продавцу' : 'Выплата продавцу (поддержка)',
            actorUserId: actor.id,
            source: 'SYSTEM',
            fundKind: 'SALE_PROCEEDS',
            saleKind: saleKindFromSubcategory(productForProvenance.subcategory),
          };
          await this.balance.credit(tx, order.sellerId, order.payoutCents, 'SALE_PAYOUT', payoutMeta);
        }
        // Paid sales only count toward public completedSales (anti-farming on free lots).
        if (order.totalAmountCents > 0n) {
          await tx.user.update({
            where: { id: order.sellerId },
            data: { completedSales: { increment: 1 }, trustDirty: true },
          });
        }
      }
      if (order.payoutCents > 0n) {
        await this.locks.lockOnSaleComplete(tx, order.sellerId, id, order.payoutCents);
      }
      const product = await tx.product.findUniqueOrThrow({ where: { id: order.productId } });
      // Legacy purchases set RESERVED without decrementing; new path decrements at buy-time.
      const legacyUndecremented = product.status === 'RESERVED' && product.quantity >= order.quantity;
      if (legacyUndecremented) {
        await tx.product.update({
          where: { id: order.productId },
          data: product.quantity > order.quantity
            ? { quantity: { decrement: order.quantity }, status: 'ACTIVE' }
            : { quantity: 0, status: 'SOLD_OUT' },
        });
      } else {
        const openSiblings = await tx.order.count({
          where: {
            productId: order.productId,
            id: { not: id },
            status: { in: ['PAYMENT_HOLD', 'DELIVERING', 'DISPUTE'] },
          },
        });
        await tx.product.update({
          where: { id: order.productId },
          data: product.quantity < 1 && openSiblings === 0
            ? { status: 'SOLD_OUT' }
            : { status: product.quantity < 1 ? 'RESERVED' : 'ACTIVE' },
        });
      }
      await tx.orderTransition.create({
        data: {
          orderId: id,
          from: order.status,
          to: 'COMPLETED',
          actorId: actor.id,
          idempotencyKey: key,
          reason: opts.supportReason?.trim() || null,
        },
      });
      const note = await this.notify(tx, order.sellerId, 'ORDER_UPDATE', 'Сделка завершена', 'Средства зачислены на баланс.', id);
      await this.audit(tx, actor.id, 'ORDER_COMPLETE', id, {
        ...(opts.requireBuyer ? {} : { support: true }),
        ...(opts.supportReason ? { reason: opts.supportReason } : {}),
        fromStatus: order.status,
      });
      return [note.id];
    });
  }

  async cancel(user: AuthUser, id: bigint, key: string, reason?: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Сделка не найдена.');
    // Buyer cannot cancel — only support/admin. Parties open support on the order instead.
    if (!canActAsSupport(user)) {
      throw new BadRequestException('Отмена заказа доступна только через поддержку. Напишите в поддержку по сделке.');
    }
    return this.refund(user, id, ['PAYMENT_HOLD'], 'CANCELED', key, reason);
  }

  /** @deprecated Use POST /orders/:id/support — kept as alias for older clients. */
  async dispute(user: AuthUser, id: bigint, key: string, reason?: string) {
    await this.support.open(user, id, reason, key);
    const row = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true, buyerId: true, sellerId: true, chatId: true },
    });
    if (row) this.emitOrderUpdated(row);
    return this.one(user, id);
  }

  refundByAdmin(actor: AuthUser, id: bigint, reason?: string) {
    const key = `order:${id}:admin-refund`;
    return this.refund(actor, id, [...REFUND_FROM], 'REFUNDED', key, reason);
  }

  /**
   * Seller-initiated refund:
   * - funds still held (PAYMENT_HOLD | DELIVERING | DISPUTE) → automatic Escrow refund
   * - COMPLETED (payout done) → clawback via seller with mandatory reason + audit
   */
  refundBySeller(seller: AuthUser, id: bigint, key: string, reason: string) {
    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('Укажите причину возврата.');
    return this.refund(
      seller,
      id,
      [...REFUND_FROM],
      'REFUNDED',
      key,
      `Продавец: ${trimmed}`,
      { sellerInitiated: true },
    );
  }

  private async refund(
    actor: AuthUser,
    id: bigint,
    allowed: OrderStatus[],
    target: 'CANCELED' | 'REFUNDED',
    key: string,
    reason?: string,
    opts?: { sellerInitiated?: boolean },
  ) {
    const notifyIds = await withSerializableTransaction(this.prisma, async (tx) => {
      const replay = await tx.orderTransition.findUnique({ where: { idempotencyKey: key } });
      if (replay) {
        if (replay.orderId !== id || replay.to !== target) {
          throw new ConflictException('Ключ идемпотентности уже использован для другого действия.');
        }
        const existing = await tx.order.findUniqueOrThrow({ where: { id } });
        return this.pendingOrderNotifyIds(tx, id, [existing.buyerId, existing.sellerId]);
      }
      await lockOrderForUpdate(tx, id);
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Сделка не найдена.');
      const participant = order.buyerId === actor.id || order.sellerId === actor.id;
      const support = canActAsSupport(actor);
      const sellerInitiated = Boolean(opts?.sellerInitiated) && order.sellerId === actor.id;
      if (!participant && !support) throw new BadRequestException('Нет доступа к сделке.');
      if (order.status === 'COMPLETED') {
        if (!support && !sellerInitiated) {
          throw new BadRequestException('После завершения возврат доступен продавцу или поддержке.');
        }
        if (!reason?.trim()) {
          throw new BadRequestException('Укажите причину возврата после завершённой сделки.');
        }
        // Self-service refunds are only allowed while the seller's proceeds are still
        // held by the warranty window. Outside it the payout is withdrawable, so the
        // clawback records uncollectable debt and the platform funds the refund —
        // a repeatable seller+buyer drain. Support keeps the override (human call).
        if (!support && !(await warrantyWindowOpenForOrder(tx, order))) {
          throw new ConflictException(
            'Гарантийное окно по сделке закрыто. Возврат после завершения возможен только через поддержку.',
          );
        }
      } else if (sellerInitiated && order.sellerId !== actor.id) {
        throw new BadRequestException('Возврат может инициировать только продавец.');
      }
      if (order.status === target) {
        return this.pendingOrderNotifyIds(tx, id, [order.buyerId, order.sellerId]);
      }
      // CANCELED/REFUNDED/COMPLETED (wrong target) cannot morph into another terminal via this path.
      if (order.status === 'CANCELED' || order.status === 'REFUNDED') {
        throw new ConflictException(`Сделка уже в статусе ${order.status}: возврат/отмена недоступны.`);
      }
      assertStatusIn(order.status, allowed, target === 'CANCELED' ? 'cancel' : 'refund');
      await lockProductForUpdate(tx, order.productId);
      await lockUsersInIdOrder(tx, [order.buyerId, order.sellerId]);
      const changed = await tx.order.updateMany({
        where: { id, status: { in: allowed } },
        data: { status: target, canceledAt: new Date(), disputeReason: reason },
      });
      if (!changed.count) {
        throw new ConflictException('Возврат невозможен в текущем статусе.');
      }

      // After COMPLETED: claw back seller proceeds only (≤ payout). Platform fee stays with platform.
      // Buyer still receives full totalAmount refund; BalanceService never goes negative.
      if (order.status === 'COMPLETED' && order.payoutCents > 0n) {
        await this.clawbacks.clawbackOnRefund(tx, {
          orderId: id,
          sellerId: order.sellerId,
          amountCents: order.payoutCents,
          reason,
        });
      }

      const ledgerKey = `order:${id}:${target.toLowerCase()}`;
      if (order.totalAmountCents > 0n) {
        const refundMeta: LedgerWriteMeta = {
          idempotencyKey: ledgerKey,
          orderId: id,
          description: 'Возврат покупателю',
          actorUserId: actor.id,
          source: 'SYSTEM',
          fundKind: 'USER_OWNED',
        };
        await this.balance.credit(tx, order.buyerId, order.totalAmountCents, 'REFUND', refundMeta);
      }
      // Release deposit freeze tied to this order (COMPLETED refund / cancel).
      await this.locks.releaseForOrder(tx, id);
      if (order.status !== 'COMPLETED') {
        const product = await tx.product.findUniqueOrThrow({
          where: { id: order.productId },
          select: { status: true, quantity: true },
        });
        // Legacy: RESERVED without stock decrement — just reopen. New: restore units.
        const legacyUndecremented = product.status === 'RESERVED' && product.quantity >= order.quantity;
        await tx.product.update({
          where: { id: order.productId },
          data: legacyUndecremented
            ? { status: 'ACTIVE' }
            : { quantity: { increment: order.quantity }, status: 'ACTIVE' },
        });
      }
      await tx.orderTransition.create({
        data: { orderId: id, from: order.status, to: target, actorId: actor.id, idempotencyKey: key, reason },
      });
      await this.audit(tx, actor.id, `ORDER_${target}`, id, {
        ...(reason ? { reason } : {}),
        ...(sellerInitiated ? { sellerInitiated: true } : {}),
        ...(support ? { support: true } : {}),
        fromStatus: order.status,
        ...(order.status === 'COMPLETED' && target === 'REFUNDED'
          ? {
            feeCents: order.feeCents.toString(),
            payoutCents: order.payoutCents.toString(),
            clawbackAmountCents: order.payoutCents.toString(),
          }
          : {}),
      });
      if (target === 'REFUNDED' || target === 'CANCELED') {
        await hideReviewsForOrder(tx as never, id, 'REFUND');
      }
      const title = target === 'REFUNDED' ? 'Возврат' : 'Заказ отменён';
      const body = target === 'REFUNDED'
        ? 'Деньги из сейфа ONIX возвращены покупателю.'
        : 'Заказ отменён, оплата возвращена на баланс.';
      const buyerNote = await this.notify(tx, order.buyerId, 'ORDER_UPDATE', title, body, id);
      const sellerNote = await this.notify(tx, order.sellerId, 'ORDER_UPDATE', title, body, id);
      return [buyerNote.id, sellerNote.id];
    });

    deliverTelegramAfterCommit(this.prisma, notifyIds);

    const live = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true, buyerId: true, sellerId: true, chatId: true, productId: true },
    });
    if (live) {
      this.emitOrderUpdated(live);
      const productLive = await this.prisma.product.findUnique({
        where: { id: live.productId },
        select: { id: true, status: true, quantity: true },
      });
      if (productLive) this.emitProductChanged(productLive);
    }

    if (canActAsSupport(actor)) {
      await this.prisma.supportTicket.updateMany({
        where: { orderId: id, status: 'OPEN' },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          totalAmountCents: true,
          status: true,
          createdAt: true,
          ...dealWarrantySelect,
          product: { select: dealProductSelect },
          buyer: { select: dealPartySelect },
          seller: { select: dealPartySelect },
          reviews: { select: { authorId: true } },
          chat: { select: { id: true } },
        },
      });
      if (order.chat?.id) {
        await this.prisma.message.create({
          data: {
            chatId: order.chat.id,
            kind: 'SYSTEM',
            senderId: null,
            text: [
              `Решение поддержки по заказу #${id}: возврат покупателю.`,
              'Деньги из сейфа ONIX возвращены покупателю.',
              'Сделка закрыта. Продавец выплату не получает.',
            ].join('\n'),
          },
        });
        await this.prisma.chat.update({ where: { id: order.chat.id }, data: { updatedAt: new Date() } });
      }
      return dealDto(order, actor);
    }
    return this.one(actor, id);
  }

  private async transition(
    id: bigint, actor: AuthUser, from: OrderStatus, to: OrderStatus,
    role: 'seller' | 'buyer', key: string,
  ) {
    return withSerializableTransaction(this.prisma, async (tx) => {
      const replay = await tx.orderTransition.findUnique({ where: { idempotencyKey: key } });
      if (replay) {
        if (replay.orderId !== id || replay.to !== to) {
          throw new ConflictException('Ключ идемпотентности уже использован для другого действия.');
        }
        return tx.order.findUniqueOrThrow({ where: { id } });
      }
      await lockOrderForUpdate(tx, id);
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Сделка не найдена.');
      const ownerId = role === 'seller' ? order.sellerId : order.buyerId;
      if (ownerId !== actor.id) throw new BadRequestException('Нет прав на это действие.');
      if (order.status === to) return order;
      assertNotTerminalForMutation(order.status, `${from}→${to}`);
      if (order.status !== from) {
        throw new ConflictException(`Недопустимый переход состояния сделки из ${order.status}.`);
      }
      const changed = await tx.order.updateMany({ where: { id, status: from }, data: { status: to } });
      if (!changed.count) {
        throw new ConflictException('Недопустимый переход состояния сделки.');
      }
      await tx.orderTransition.create({
        data: { orderId: id, from, to, actorId: actor.id, idempotencyKey: key },
      });
      return tx.order.findUniqueOrThrow({ where: { id } });
    });
  }

  private async one(user: AuthUser, id: bigint) {
    const order = await this.prisma.order.findFirstOrThrow({
      where: { id, OR: [{ buyerId: user.id }, { sellerId: user.id }] },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        totalAmountCents: true,
        status: true,
        createdAt: true,
        ...dealWarrantySelect,
        product: { select: dealProductSelect },
        buyer: { select: dealPartySelect },
        seller: { select: dealPartySelect },
        reviews: { select: { authorId: true } },
        chat: { select: { id: true } },
      },
    });
    return dealDto(order, user);
  }
  private async pendingOrderNotifyIds(
    tx: Prisma.TransactionClient,
    orderId: bigint,
    userIds: bigint[],
  ): Promise<bigint[]> {
    const rows = await tx.notification.findMany({
      where: {
        userId: { in: userIds },
        type: 'ORDER_UPDATE',
        telegramPushedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 16,
      select: { id: true, data: true },
    });
    const want = orderId.toString();
    return rows.filter((row) => notificationOrderId(row.data) === want).map((row) => row.id);
  }

  private notify(tx: Prisma.TransactionClient, userId: bigint, type: 'ORDER_UPDATE', title: string, body: string, orderId: bigint) {
    return tx.notification.create({ data: { userId, type, title, body, data: { orderId: orderId.toString() } } });
  }
  private audit(tx: Prisma.TransactionClient, actorId: bigint, action: string, id: bigint, metadata?: Prisma.InputJsonObject) {
    return tx.auditLog.create({ data: { actorId, action, entity: 'Order', entityId: id.toString(), metadata } });
  }
}

@Controller('orders')
export class EscrowController {
  constructor(
    private readonly service: EscrowService,
    private readonly rateLimit: DistributedRateLimiter,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: AuthUser, @Query() query: OrderQuery) {
    return this.service.list(user, query);
  }
  @Post('product/:productId') async purchase(@CurrentUser() user: AuthUser, @Param('productId') id: string, @Body() dto: PurchaseDto) {
    await this.rateLimit.assert(`order:purchase:${user.id}`, 30, 60_000);
    return this.service.purchase(user, id, dto.idempotencyKey, dto.quantity);
  }
  @Post(':id/deliver') async deliver(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    await this.rateLimit.assert(`order:mutate:${user.id}`, 60, 60_000);
    return this.service.deliver(user, parseId(id), dto.idempotencyKey);
  }
  @Post(':id/complete') async complete(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    await this.rateLimit.assert(`order:mutate:${user.id}`, 60, 60_000);
    return this.service.complete(user, parseId(id), dto.idempotencyKey);
  }
  @Post(':id/cancel') async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    await this.rateLimit.assert(`order:mutate:${user.id}`, 60, 60_000);
    return this.service.cancel(user, parseId(id), dto.idempotencyKey, dto.reason);
  }
  @Post(':id/dispute') async dispute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    await this.rateLimit.assert(`order:support:${user.id}`, 20, 60_000);
    return this.service.dispute(user, parseId(id), dto.idempotencyKey, dto.reason);
  }
  @Post(':id/refund-request') async refundRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SellerRefundDto,
  ) {
    await this.rateLimit.assert(`order:refund:${user.id}`, 20, 60_000);
    return this.service.refundBySeller(user, parseId(id), dto.idempotencyKey, dto.reason);
  }
}

@Module({
  imports: [forwardRef(() => EconomyModule), RealtimeModule, RiskModule, SupportModule],
  controllers: [EscrowController],
  providers: [
    EscrowService,
    { provide: CHECKOUT_SETTLEMENT, useExisting: EscrowService },
  ],
  exports: [EscrowService, CHECKOUT_SETTLEMENT],
})
export class EscrowModule {}
