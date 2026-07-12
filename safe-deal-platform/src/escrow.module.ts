import {
  BadRequestException, Body, ConflictException, Controller, Get, Injectable,
  Module, NotFoundException, Param, Post,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, parseId } from './common';
import { PrismaService } from './prisma.service';
import { dealDto } from './response';

class PurchaseDto {
  @IsString() @Length(16, 100) idempotencyKey!: string;
  @IsOptional() @IsInt() @Min(1) @Max(10000) quantity = 1;
}
class ReasonDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsString() @Length(16, 100) idempotencyKey!: string;
}

@Injectable()
export class EscrowService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const orders = await this.prisma.order.findMany({
      where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] },
      include: {
        product: true,
        buyer: { include: { _count: { select: { followers: true } } } },
        seller: { include: { _count: { select: { followers: true } } } },
        reviews: { select: { authorId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((order) => dealDto(order, user));
  }

  async purchase(user: AuthUser, productId: string, key: string, quantity: number) {
    const order = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        if (existing.buyerId !== user.id || existing.productId !== productId || existing.quantity !== quantity) {
          throw new ConflictException('Ключ идемпотентности уже использован для другого запроса.');
        }
        return existing;
      }
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product || product.status !== 'ACTIVE' || product.expiresAt <= new Date() || product.quantity < quantity) {
        throw new ConflictException('Товар недоступен.');
      }
      if (product.sellerId === user.id) throw new BadRequestException('Нельзя купить собственный товар.');
      const totalAmountCents = product.priceCents * BigInt(quantity);
      const reserved = await tx.product.updateMany({
        where: { id: product.id, status: 'ACTIVE', quantity: { gte: quantity } },
        data: { status: 'RESERVED' },
      });
      if (!reserved.count) throw new ConflictException('Товар уже зарезервирован.');
      const debited = await tx.user.updateMany({
        where: { id: user.id, balanceCents: { gte: totalAmountCents } },
        data: { balanceCents: { decrement: totalAmountCents } },
      });
      if (!debited.count) throw new BadRequestException('Недостаточно средств.');
      const balance = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { balanceCents: true } });
      const order = await tx.order.create({
        data: {
          productId, buyerId: user.id, sellerId: product.sellerId,
          totalAmountCents, payoutCents: totalAmountCents, quantity,
          status: 'PAYMENT_HOLD', idempotencyKey: key,
          transitions: { create: {
            from: 'PENDING', to: 'PAYMENT_HOLD', actorId: user.id,
            idempotencyKey: `order:${key}:create`,
          } },
          ledgerEntries: { create: {
            userId: user.id, type: 'PURCHASE_HOLD', amountCents: -totalAmountCents,
            balanceAfterCents: balance.balanceCents, idempotencyKey: `order:${key}:hold`,
          } },
          chat: { create: { members: { create: [{ userId: user.id }, { userId: product.sellerId }] } } },
        },
      });
      await this.notify(tx, product.sellerId, 'ORDER_UPDATE', 'Новая покупка', `Куплен товар «${product.title}»`, order.id);
      await this.audit(tx, user.id, 'ORDER_PURCHASE', order.id, { productId });
      return order;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.one(user, order.id);
  }

  async deliver(user: AuthUser, id: bigint, key: string) {
    await this.transition(id, user, 'PAYMENT_HOLD', 'DELIVERING', 'seller', key);
    return this.one(user, id);
  }

  async complete(user: AuthUser, id: bigint, key: string) {
    await this.prisma.$transaction(async (tx) => {
      const replay = await tx.orderTransition.findUnique({ where: { idempotencyKey: key } });
      if (replay) {
        if (replay.orderId !== id || replay.to !== 'COMPLETED') {
          throw new ConflictException('Ключ идемпотентности уже использован для другого действия.');
        }
        return;
      }
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Сделка не найдена.');
      if (order.buyerId !== user.id) throw new BadRequestException('Только покупатель подтверждает получение.');
      const changed = await tx.order.updateMany({
        where: { id, status: 'DELIVERING' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (!changed.count) {
        if (order.status === 'COMPLETED') return order;
        throw new ConflictException('Сделку нельзя завершить в текущем статусе.');
      }
      const seller = await tx.user.update({
        where: { id: order.sellerId },
        data: { balanceCents: { increment: order.payoutCents }, completedSales: { increment: 1 } },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: order.sellerId, orderId: id, type: 'SALE_PAYOUT', amountCents: order.payoutCents,
          balanceAfterCents: seller.balanceCents, idempotencyKey: `order:${id}:payout`,
        },
      });
      const product = await tx.product.findUniqueOrThrow({ where: { id: order.productId } });
      await tx.product.update({
        where: { id: order.productId },
        data: product.quantity > order.quantity
          ? { quantity: { decrement: order.quantity }, status: 'ACTIVE' }
          : { quantity: 0, status: 'SOLD_OUT' },
      });
      await tx.orderTransition.create({
        data: { orderId: id, from: 'DELIVERING', to: 'COMPLETED', actorId: user.id, idempotencyKey: key },
      });
      await this.notify(tx, order.sellerId, 'ORDER_UPDATE', 'Сделка завершена', 'Средства зачислены на баланс.', id);
      await this.audit(tx, user.id, 'ORDER_COMPLETE', id);
      return tx.order.findUniqueOrThrow({ where: { id } });
    });
    return this.one(user, id);
  }

  async cancel(user: AuthUser, id: bigint, reason?: string) {
    return this.refund(user, id, ['PAYMENT_HOLD'], 'CANCELED', reason);
  }

  async dispute(user: AuthUser, id: bigint, key: string, reason?: string) {
    const replay = await this.prisma.orderTransition.findUnique({ where: { idempotencyKey: key } });
    if (replay) {
      if (replay.orderId !== id || replay.to !== 'DISPUTE') {
        throw new ConflictException('Ключ идемпотентности уже использован для другого действия.');
      }
      return this.one(user, id);
    }
    const order = await this.memberOrder(user, id);
    if (order.status === 'DISPUTE') return this.one(user, id);
    if (!['PAYMENT_HOLD', 'DELIVERING'].includes(order.status)) throw new ConflictException('Спор сейчас открыть нельзя.');
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({
        where: { id, status: order.status },
        data: { status: 'DISPUTE', disputeReason: reason },
      });
      if (!changed.count) throw new ConflictException('Состояние сделки уже изменилось.');
      await tx.orderTransition.create({
        data: { orderId: id, from: order.status, to: 'DISPUTE', actorId: user.id, idempotencyKey: key, reason },
      });
      await this.audit(tx, user.id, 'ORDER_DISPUTE', id, reason ? { reason } : undefined);
      return tx.order.findUniqueOrThrow({ where: { id } });
    });
    return this.one(user, id);
  }

  refundByAdmin(actor: AuthUser, id: bigint, reason?: string) {
    return this.refund(actor, id, ['PAYMENT_HOLD', 'DELIVERING', 'DISPUTE'], 'REFUNDED', reason);
  }

  private refund(actor: AuthUser, id: bigint, allowed: OrderStatus[], target: 'CANCELED' | 'REFUNDED', reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Сделка не найдена.');
      const participant = order.buyerId === actor.id || order.sellerId === actor.id;
      if (!participant && !actor.isAdmin) throw new BadRequestException('Нет доступа к сделке.');
      const changed = await tx.order.updateMany({
        where: { id, status: { in: allowed } },
        data: { status: target, canceledAt: new Date(), disputeReason: reason },
      });
      if (!changed.count) {
        if (order.status === target) return order;
        throw new ConflictException('Возврат невозможен в текущем статусе.');
      }
      const buyer = await tx.user.update({
        where: { id: order.buyerId }, data: { balanceCents: { increment: order.totalAmountCents } },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: order.buyerId, orderId: id, type: 'REFUND', amountCents: order.totalAmountCents,
          balanceAfterCents: buyer.balanceCents, idempotencyKey: `order:${id}:${target.toLowerCase()}`,
        },
      });
      await tx.product.update({ where: { id: order.productId }, data: { status: 'ACTIVE' } });
      await tx.orderTransition.create({ data: { orderId: id, from: order.status, to: target, actorId: actor.id, reason } });
      await this.audit(tx, actor.id, `ORDER_${target}`, id, reason ? { reason } : undefined);
      return tx.order.findUniqueOrThrow({ where: { id } });
    });
  }

  private async transition(
    id: bigint, actor: AuthUser, from: OrderStatus, to: OrderStatus,
    role: 'seller' | 'buyer', key: string,
  ) {
    const replay = await this.prisma.orderTransition.findUnique({ where: { idempotencyKey: key } });
    if (replay) {
      if (replay.orderId !== id || replay.to !== to) {
        throw new ConflictException('Ключ идемпотентности уже использован для другого действия.');
      }
      return this.prisma.order.findUniqueOrThrow({ where: { id } });
    }
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Сделка не найдена.');
    const ownerId = role === 'seller' ? order.sellerId : order.buyerId;
    if (ownerId !== actor.id) throw new BadRequestException('Нет прав на это действие.');
    const changed = await this.prisma.order.updateMany({ where: { id, status: from }, data: { status: to } });
    if (!changed.count) {
      if (order.status === to) return order;
      throw new ConflictException('Недопустимый переход состояния сделки.');
    }
    await this.prisma.orderTransition.create({
      data: { orderId: id, from, to, actorId: actor.id, idempotencyKey: key },
    });
    return this.prisma.order.findUniqueOrThrow({ where: { id } });
  }

  private async memberOrder(user: AuthUser, id: bigint) {
    const order = await this.prisma.order.findFirst({ where: { id, OR: [{ buyerId: user.id }, { sellerId: user.id }] } });
    if (!order) throw new NotFoundException('Сделка не найдена.');
    return order;
  }
  private async one(user: AuthUser, id: bigint) {
    const order = await this.prisma.order.findFirstOrThrow({
      where: { id, OR: [{ buyerId: user.id }, { sellerId: user.id }] },
      include: {
        product: true,
        buyer: { include: { _count: { select: { followers: true } } } },
        seller: { include: { _count: { select: { followers: true } } } },
        reviews: { select: { authorId: true } },
      },
    });
    return dealDto(order, user);
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
  constructor(private readonly service: EscrowService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.service.list(user); }
  @Post('product/:productId') purchase(@CurrentUser() user: AuthUser, @Param('productId') id: string, @Body() dto: PurchaseDto) {
    return this.service.purchase(user, id, dto.idempotencyKey, dto.quantity);
  }
  @Post(':id/deliver') deliver(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) { return this.service.deliver(user, parseId(id), dto.idempotencyKey); }
  @Post(':id/complete') complete(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) { return this.service.complete(user, parseId(id), dto.idempotencyKey); }
  @Post(':id/cancel') cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) { return this.service.cancel(user, parseId(id), dto.reason); }
  @Post(':id/dispute') dispute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) { return this.service.dispute(user, parseId(id), dto.idempotencyKey, dto.reason); }
}

@Module({ controllers: [EscrowController], providers: [EscrowService], exports: [EscrowService] })
export class EscrowModule {}
