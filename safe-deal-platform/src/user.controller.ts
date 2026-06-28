import {
  Controller, Get, Query,
  BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

class ApiResponse<T> {
  readonly success = true;
  constructor(public readonly data: T) {}
}

@Controller('users')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/users/profile?tgId=123456
   * Upsert пользователя при входе в Mini App.
   * Новым выдаём стартовый баланс 5000 ₽.
   */
  @Get('profile')
  async getProfile(@Query('tgId') tgIdStr: string) {
    if (!tgIdStr || !/^\d+$/.test(tgIdStr.trim())) {
      throw new BadRequestException('Параметр tgId должен быть числовой строкой.');
    }

    const telegramId = BigInt(tgIdStr.trim());
    const STARTER_BALANCE = BigInt(500_000); // 5000 руб в копейках

    try {
      const user = await this.prisma.user.upsert({
        where: { telegramId },
        update: {},
        create: {
          telegramId,
          telegramNick: `trader_${tgIdStr.substring(0, 6)}`,
          balanceCents: STARTER_BALANCE,
        },
        select: {
          id: true,
          telegramNick: true,
          balanceCents: true,
          createdAt: true,
        },
      });

      this.logger.log(`[USER] Сессия верифицирована: telegramId=${telegramId}, id=${user.id}`);

      return new ApiResponse({
        id: user.id.toString(),
        telegramNick: user.telegramNick ?? `trader_${user.id}`,
        balanceMain: (Number(user.balanceCents) / 100).toFixed(2),
        balanceBonus: '0.00',
        memberSince: user.createdAt,
      });
    } catch (err) {
      this.logger.error(`[USER PROFILE CRASH]: ${(err as Error).message}`);
      throw new BadRequestException('Ошибка инициализации профиля трейдера.');
    }
  }

  /**
   * GET /api/users/orders?tgId=123456
   * История сделок пользователя (покупки + продажи).
   */
  @Get('orders')
  async getUserOrders(@Query('tgId') tgIdStr: string) {
    if (!tgIdStr || !/^\d+$/.test(tgIdStr.trim())) {
      throw new BadRequestException('Параметр tgId должен быть числовой строкой.');
    }

    const telegramId = BigInt(tgIdStr.trim());

    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('Пользователь не найден.');

    const [buyerOrders, sellerOrders] = await Promise.all([
      this.prisma.order.findMany({
        where: { buyerId: user.id },
        include: { product: { select: { title: true, category: true } }, seller: { select: { telegramNick: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.order.findMany({
        where: { sellerId: user.id },
        include: { product: { select: { title: true, category: true } }, buyer: { select: { telegramNick: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const serialize = (orders: typeof buyerOrders, role: 'buyer' | 'seller') =>
      orders.map((o) => ({
        id: o.id.toString(),
        productId: o.productId,
        productTitle: o.product.title,
        category: o.product.category,
        totalAmountCents: o.totalAmountCents.toString(),
        status: o.status,
        role,
        counterpartyNick:
          role === 'buyer'
            ? (o as any).seller?.telegramNick ?? 'unknown'
            : (o as any).buyer?.telegramNick ?? 'unknown',
        createdAt: o.createdAt,
      }));

    return new ApiResponse({
      purchases: serialize(buyerOrders, 'buyer'),
      sales: serialize(sellerOrders as any, 'seller'),
    });
  }

  /**
   * GET /api/users/listings?tgId=123456
   * Активные лоты пользователя для профиля.
   */
  @Get('listings')
  async getUserListings(@Query('tgId') tgIdStr: string) {
    if (!tgIdStr || !/^\d+$/.test(tgIdStr.trim())) {
      throw new BadRequestException('Параметр tgId должен быть числовой строкой.');
    }

    const telegramId = BigInt(tgIdStr.trim());
    const user = await this.prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
    if (!user) throw new BadRequestException('Пользователь не найден.');

    const listings = await this.prisma.product.findMany({
      where: { sellerId: user.id, status: { in: ['ACTIVE', 'RESERVED'] } },
      orderBy: { createdAt: 'desc' },
    });

    return new ApiResponse(
      listings.map((p) => ({
        id: p.id,
        title: p.title,
        priceCents: p.priceCents.toString(),
        category: p.category,
        status: p.status,
        quantity: p.quantity,
        createdAt: p.createdAt,
      }))
    );
  }
}