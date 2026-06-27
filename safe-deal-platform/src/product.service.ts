import { Injectable, BadRequestException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateProductDto } from './dto/create-product.dto';
import { OrderStatus, ProductStatus } from '@prisma/client';
import { UserAuthUtil } from './utils/user-auth.util';

// ИММУТАБЕЛЬНЫЕ КОНТРАКТЫ ДАННЫХ (ENTERPRISE DTO ОТВЕТОВ)
export class DealInitiatedDto {
  constructor(
    public readonly success: boolean,
    public readonly orderId: string,
    public readonly status: OrderStatus,
  ) {}
}

export class OrderExecutionDto {
  constructor(
    public readonly success: boolean,
    public readonly status: OrderStatus,
    public readonly adminPureProfit: number,
    public readonly finalPayoutAmount: number,
  ) {}
}

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 📦 Выставление товара на витрину маркета (Переведено на BigInt-копейки)
   */
  async create(dto: CreateProductDto, sellerIdStr: string) {
    const sellerId = BigInt(sellerIdStr);
    const seller = await UserAuthUtil.checkUserExists(this.prisma, sellerId);
    await UserAuthUtil.checkTelegramLinked(seller);

    // Финтех-расчет: Переводим рубли из DTO в копейки BigInt для ядра базы Neon
    const priceCents = BigInt(Math.round(Number(dto.price) * 100));

    return this.prisma.product.create({
      data: {
        title: dto.title,
        description: dto.description,
        priceCents: priceCents, // Исправлено под новую схему Prisma 7
        quantity: dto.quantity,
        category: dto.category,
        sellerId: sellerId,
        status: ProductStatus.ACTIVE,
      },
      select: { id: true, title: true, priceCents: true, createdAt: true },
    });
  }

  /**
   * ὒ СТАФФ-ИНЖЕНЕР ФАЗА 1: ЗАМОРОЗКА С БЛОКИРОВКОЙ "NOWAIT" И ЭМИТТЕРОМ СОБЫТИЙ [PDF: 0.1.7]
   */
  async initiateP2PDeal(buyerId: bigint, productId: string): Promise<DealInitiatedDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Запрос к базе данных Postgres с блокировкой строки FOR UPDATE NOWAIT [PDF: 0.1.8]
        const products: any[] = await tx.$queryRaw`
          SELECT id, status, "priceCents", "sellerId" 
          FROM "Product" 
          WHERE id = ${productId} 
          FOR UPDATE NOWAIT
        `;
        const targetProduct = products[0];

        if (!targetProduct || targetProduct.status !== ProductStatus.ACTIVE) {
          throw new ConflictException('Лот временно заблокирован или уже перехвачен другим снайпером.');
        }

        // Обновляем статус лота в RESERVED
        await tx.product.update({
          where: { id: productId },
          data: { status: ProductStatus.RESERVED },
        });

        // ИСПРАВЛЕНО: Свойства заменены на totalAmountCents в соответствии с schema.prisma!
        const newOrder = await tx.order.create({
          data: {
            productId: targetProduct.id,
            buyerId: buyerId,
            sellerId: targetProduct.sellerId,
            totalAmountCents: targetProduct.priceCents, // Баг TS2339 полностью ликвидирован!
            status: OrderStatus.PAYMENT_HOLD,
          },
        });

        const orderIdStr = newOrder.id.toString();

        // Выстреливаем событием в глобальную Event-сеть бэкенда NestJS
        this.eventEmitter.emit('order.initiated', {
          orderId: orderIdStr,
          buyerId,
          sellerId: targetProduct.sellerId,
          price: targetProduct.priceCents.toString(),
        });

        return new DealInitiatedDto(true, orderIdStr, OrderStatus.PAYMENT_HOLD);
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(`[Ὢ TRANSACTION FAILURE PHASE 1]: ${err.message}`);
      if (error instanceof ConflictException) throw error;
      throw new BadRequestException(err.message || 'Ошибка выполнения изоляции контракта Гаранта.');
    }
  }

  /**
   * ὒ СТАФФ-ИНЖЕНЕР ФАЗА 2: ОБНОВЛЕНИЕ СТАТУСА ДОСТАВКИ ПРОДАВЦОМ [PDF: 0.1.8]
   */
  async confirmDelivery(sellerId: bigint, orderId: bigint): Promise<{ success: boolean; status: OrderStatus }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { product: true },
    });

    if (!order) throw new NotFoundException('Указанный ордер отсутствует в реестре PostgreSQL.');
    if (order.sellerId !== sellerId) throw new BadRequestException('Нарушение прав доступа к контракту.');
    if (order.status !== OrderStatus.PAYMENT_HOLD) throw new BadRequestException('Действие невозможно для текущего статуса ордера.');

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DELIVERING },
    });

    this.eventEmitter.emit('order.delivering', {
      orderId: order.id.toString(),
      buyerId: order.buyerId,
      productTitle: order.product.title,
    });

    return { success: true, status: updatedOrder.status };
  }

  /**
   * ὒ СТАФФ-ИНЖЕНЕР ФАЗА 3: ЗАКРЫТИЕ СДЕЛКИ И АВТОМАТИЧЕСКАЯ МГНОВЕННАЯ ВЫПЛАТА С 2% СПРЕДОМ [PDF: 0.1.9]
   */
  async completeOrderAndInstantWithdraw(buyerId: bigint, orderId: bigint): Promise<OrderExecutionDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
        });

        if (!order) throw new NotFoundException('Ордер не найден.');
        if (order.buyerId !== buyerId) throw new BadRequestException('Нарушение прав доступа к финализации.');
        if (order.status !== OrderStatus.DELIVERING) throw new BadRequestException('Продавец ещё не отгрузил ценности.');

        const visibleWithdrawRate = parseFloat(process.env.WITHDRAW_VISIBLE_RATE || '0.05');
        const hiddenAdminRate = parseFloat(process.env.WITHDRAW_HIDDEN_RATE || '0.02');

        // Математика переведена на работу с BigInt-копейками СУБД Neon
        const totalPriceCents = Number(order.totalAmountCents);
        const visibleCommission = totalPriceCents * visibleWithdrawRate;
        const adminPureProfit = totalPriceCents * hiddenAdminRate;
        const instantPayoutAmount = totalPriceCents - visibleCommission;

        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.COMPLETED },
        });

        await tx.product.update({
          where: { id: order.productId },
          data: { status: ProductStatus.SOLD_OUT },
        });

        this.logger.log(`[Ὠ INSTANT CLEARING]: Контракт №${orderId} закрыт. Выплата: ${instantPayoutAmount / 100} ₽. Маржа Максима (2%): +${adminPureProfit / 100} ₽.`);

        this.eventEmitter.emit('order.completed', {
          orderId: orderId.toString(),
          buyerId,
          sellerId: order.sellerId,
          totalPrice: (totalPriceCents / 100).toString(),
          commission: (visibleCommission / 100).toFixed(2),
          payout: (instantPayoutAmount / 100).toFixed(2),
        });

        return new OrderExecutionDto(true, OrderStatus.COMPLETED, adminPureProfit / 100, instantPayoutAmount / 100);
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(`[Ὢ TRANSACTION FAILURE PHASE 3]: ${err.message}`);
      throw error;
    }
  }
}