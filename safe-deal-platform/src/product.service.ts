import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, ProductStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UserAuthUtil } from './utils/user-auth.util';

// ─── Контракты ответов ──────────────────────────────────────────────────────

export interface ProductCreatedDto {
  id: string;
  title: string;
  priceCents: string; // BigInt → string для фронтенда
  category: string;
  createdAt: Date;
}

export interface DealInitiatedDto {
  success: boolean;
  orderId: string;
  status: OrderStatus;
}

export interface DeliveryConfirmedDto {
  success: boolean;
  status: OrderStatus;
}

export interface OrderCompletedDto {
  success: boolean;
  status: OrderStatus;
  payoutRubles: string;  // продавцу упало на баланс
}

export interface WithdrawalDto {
  success: boolean;
  withdrawalId: string;
  payoutRubles: string;   // сумма к отправке на карту
  feeRubles: string;      // комиссия 50 руб
}

export interface ProductListDto {
  id: string;
  title: string;
  description: string | null;
  priceCents: string;
  category: string;
  sellerNick: string;
  sellerId: string;
  status: ProductStatus;
  createdAt: Date;
}

// ─── Константы ──────────────────────────────────────────────────────────────

/** Комиссия при завершении сделки: 0% — продавец получает полную сумму */
const DEAL_FEE_RATE = 0;

/** Фиксированная комиссия при выводе на карту в копейках (50 руб) */
const WITHDRAWAL_FEE_CENTS = BigInt(5000);

/** Минимальная сумма вывода в копейках (100 руб) */
const WITHDRAWAL_MIN_CENTS = BigInt(10000);

// ─── Сервис ─────────────────────────────────────────────────────────────────

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // ВИТРИНА: список активных лотов с фильтром по категории
  // ═══════════════════════════════════════════════════════════════════════════

  async getProducts(category?: string): Promise<ProductListDto[]> {
    const products = await this.prisma.product.findMany({
      where: {
        status: ProductStatus.ACTIVE,
        ...(category ? { category } : {}),
      },
      include: {
        seller: { select: { telegramNick: true, telegramId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return products.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description ?? null,
      priceCents: p.priceCents.toString(),
      category: p.category,
      sellerNick: p.seller.telegramNick ?? `trader_${p.sellerId}`,
      sellerId: p.sellerId.toString(),
      status: p.status,
      createdAt: p.createdAt,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // СОЗДАНИЕ ЛОТА
  // ═══════════════════════════════════════════════════════════════════════════

  async create(dto: CreateProductDto): Promise<ProductCreatedDto> {
    // sellerId приходит как строка Telegram ID → находим внутренний User.id
    const telegramId = BigInt(dto.sellerId);
    const seller = await UserAuthUtil.findByTelegramId(this.prisma, telegramId);
    UserAuthUtil.checkTelegramLinked(seller);

    const priceCents = BigInt(Math.round(dto.price * 100));

    const product = await this.prisma.product.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        priceCents,
        quantity: dto.quantity,
        category: dto.category,
        sellerId: seller.id,
        status: ProductStatus.ACTIVE,
      },
      select: { id: true, title: true, priceCents: true, category: true, createdAt: true },
    });

    this.logger.log(`[PRODUCT] Лот "${product.title}" опубликован продавцом #${seller.id}`);

    return {
      id: product.id,
      title: product.title,
      priceCents: product.priceCents.toString(),
      category: product.category,
      createdAt: product.createdAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ФАЗА 1: Покупатель оплачивает → деньги в холд
  // ═══════════════════════════════════════════════════════════════════════════

  async initiateP2PDeal(buyerTgId: bigint, productId: string): Promise<DealInitiatedDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Блокируем строку FOR UPDATE NOWAIT — защита от гонок при одновременных покупках
        const rows: Array<{
          id: string;
          status: string;
          priceCents: bigint;
          sellerId: bigint;
        }> = await tx.$queryRaw`
          SELECT id, status, "priceCents", "sellerId"
          FROM "Product"
          WHERE id = ${productId}
          FOR UPDATE NOWAIT
        `;

        const product = rows[0];
        if (!product || product.status !== ProductStatus.ACTIVE) {
          throw new ConflictException('Лот уже зарезервирован или недоступен.');
        }

        // Находим покупателя по telegramId
        const buyer = await tx.user.findUnique({ where: { telegramId: buyerTgId } });
        if (!buyer) throw new NotFoundException('Покупатель не найден в системе.');

        // Проверяем баланс
        if (buyer.balanceCents < product.priceCents) {
          throw new BadRequestException(
            `Недостаточно средств. Нужно ${this.centsToRubles(product.priceCents)} ₽, ` +
            `на балансе ${this.centsToRubles(buyer.balanceCents)} ₽.`
          );
        }

        // Нельзя покупать свой лот
        if (product.sellerId === buyer.id) {
          throw new BadRequestException('Нельзя купить собственный лот.');
        }

        // Списываем деньги с баланса покупателя
        await tx.user.update({
          where: { id: buyer.id },
          data: { balanceCents: { decrement: product.priceCents } },
        });

        // Переводим лот в RESERVED
        await tx.product.update({
          where: { id: productId },
          data: { status: ProductStatus.RESERVED },
        });

        // Создаём ордер в статусе PAYMENT_HOLD
        const order = await tx.order.create({
          data: {
            productId: product.id,
            buyerId: buyer.id,
            sellerId: product.sellerId,
            totalAmountCents: product.priceCents,
            feeCents: BigInt(DEAL_FEE_RATE),   // 0 копеек комиссии
            payoutCents: product.priceCents,    // продавец получит 100%
            status: OrderStatus.PAYMENT_HOLD,
          },
        });

        const orderId = order.id.toString();
        this.logger.log(`[DEAL] Ордер #${orderId} создан. Холд ${this.centsToRubles(product.priceCents)} ₽.`);

        // Уведомляем через event-шину (Telegram чеки)
        this.eventEmitter.emit('order.created', {
          orderId,
          buyerTgId: buyerTgId.toString(),
          sellerTgId: (await tx.user.findUnique({ where: { id: product.sellerId }, select: { telegramId: true } }))?.telegramId?.toString(),
          title: (await tx.product.findUnique({ where: { id: productId }, select: { title: true } }))?.title ?? productId,
          priceRub: Number(product.priceCents) / 100,
        });

        return { success: true, orderId, status: OrderStatus.PAYMENT_HOLD };
      });
    } catch (err) {
      if (err instanceof ConflictException || err instanceof BadRequestException || err instanceof NotFoundException) {
        throw err;
      }
      const msg = (err as Error).message;
      this.logger.error(`[DEAL PHASE 1 CRASH]: ${msg}`);
      throw new BadRequestException('Ошибка транзакции. Попробуйте ещё раз.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ФАЗА 2: Продавец подтверждает отправку
  // ═══════════════════════════════════════════════════════════════════════════

  async confirmDelivery(sellerTgId: bigint, orderId: bigint): Promise<DeliveryConfirmedDto> {
    const seller = await UserAuthUtil.findByTelegramId(this.prisma, sellerTgId);

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Ордер не найден.');
    if (order.sellerId !== seller.id) throw new BadRequestException('Нет прав на управление этим ордером.');
    if (order.status !== OrderStatus.PAYMENT_HOLD) {
      throw new BadRequestException('Подтверждение отправки невозможно: неверный статус ордера.');
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DELIVERING },
    });

    this.logger.log(`[DEAL] Ордер #${orderId} → DELIVERING`);

    this.eventEmitter.emit('order.delivering', {
      orderId: orderId.toString(),
      buyerId: order.buyerId.toString(),
    });

    return { success: true, status: OrderStatus.DELIVERING };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ФАЗА 3: Покупатель подтверждает получение → деньги продавцу
  // ═══════════════════════════════════════════════════════════════════════════

  async completeOrder(buyerTgId: bigint, orderId: bigint): Promise<OrderCompletedDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const buyer = await tx.user.findUnique({ where: { telegramId: buyerTgId } });
        if (!buyer) throw new NotFoundException('Покупатель не найден.');

        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order) throw new NotFoundException('Ордер не найден.');
        if (order.buyerId !== buyer.id) throw new BadRequestException('Нет прав на завершение этого ордера.');
        if (order.status !== OrderStatus.DELIVERING) {
          throw new BadRequestException('Завершение невозможно: продавец ещё не подтвердил отправку.');
        }

        // Комиссия 0% — продавец получает полную сумму
        const payoutCents = order.totalAmountCents;

        // Зачисляем деньги продавцу на баланс сайта
        await tx.user.update({
          where: { id: order.sellerId },
          data: { balanceCents: { increment: payoutCents } },
        });

        // Переводим лот в SOLD_OUT
        await tx.product.update({
          where: { id: order.productId },
          data: { status: ProductStatus.SOLD_OUT },
        });

        // Закрываем ордер
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.COMPLETED,
            feeCents: BigInt(0),
            payoutCents,
          },
        });

        const payoutRubles = this.centsToRubles(payoutCents);
        this.logger.log(`[DEAL] Ордер #${orderId} COMPLETED. Выплата продавцу: ${payoutRubles} ₽`);

        this.eventEmitter.emit('order.completed', {
          orderId: orderId.toString(),
          sellerTgId: (await tx.user.findUnique({ where: { id: order.sellerId }, select: { telegramId: true } }))?.telegramId?.toString(),
          payoutRubles,
        });

        return { success: true, status: OrderStatus.COMPLETED, payoutRubles };
      });
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`[DEAL PHASE 3 CRASH]: ${(err as Error).message}`);
      throw new BadRequestException('Ошибка финализации сделки.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ВЫВОД СРЕДСТВ НА КАРТУ
  // Комиссия: 50 рублей фиксированно
  // ═══════════════════════════════════════════════════════════════════════════

  async requestWithdrawal(userTgId: bigint, amountRubles: number, idempotencyKey: string): Promise<WithdrawalDto> {
    const amountCents = BigInt(Math.round(amountRubles * 100));

    if (amountCents < WITHDRAWAL_MIN_CENTS) {
      throw new BadRequestException('Минимальная сумма вывода — 100 рублей.');
    }

    if (amountCents <= WITHDRAWAL_FEE_CENTS) {
      throw new BadRequestException('Сумма вывода должна превышать комиссию (50 ₽).');
    }

    // Идемпотентность: повторный запрос с тем же ключом вернёт тот же результат
    const existing = await this.prisma.withdrawal.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return {
        success: true,
        withdrawalId: existing.id,
        payoutRubles: this.centsToRubles(existing.payoutCents),
        feeRubles: this.centsToRubles(existing.feeCents),
      };
    }

    return await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { telegramId: userTgId } });
      if (!user) throw new NotFoundException('Пользователь не найден.');

      if (user.balanceCents < amountCents) {
        throw new BadRequestException(
          `Недостаточно средств. Баланс: ${this.centsToRubles(user.balanceCents)} ₽.`
        );
      }

      const payoutCents = amountCents - WITHDRAWAL_FEE_CENTS;

      // Списываем сумму с баланса
      await tx.user.update({
        where: { id: user.id },
        data: { balanceCents: { decrement: amountCents } },
      });

      // Создаём заявку на вывод
      const withdrawal = await tx.withdrawal.create({
        data: {
          userId: user.id,
          amountCents,
          feeCents: WITHDRAWAL_FEE_CENTS,
          payoutCents,
          idempotencyKey,
          status: 'PENDING',
        },
      });

      this.logger.log(`[WITHDRAWAL] Заявка #${withdrawal.id}: вывод ${amountRubles} ₽, к выплате ${this.centsToRubles(payoutCents)} ₽`);

      this.eventEmitter.emit('withdrawal.created', {
        withdrawalId: withdrawal.id,
        userTgId: userTgId.toString(),
        payoutRubles: this.centsToRubles(payoutCents),
      });

      return {
        success: true,
        withdrawalId: withdrawal.id,
        payoutRubles: this.centsToRubles(payoutCents),
        feeRubles: this.centsToRubles(WITHDRAWAL_FEE_CENTS),
      };
    });
  }

  // ─── Утилита ────────────────────────────────────────────────────────────────

  private centsToRubles(cents: bigint): string {
    return (Number(cents) / 100).toFixed(2);
  }
}