import { Controller, Post, Body, BadRequestException, HttpCode, HttpStatus, Get } from '@nestjs/common';
import { IsString, IsNotEmpty, IsNumber } from 'class-validator';
import { PrismaService } from './prisma.service';

export class CreateProductDto {
  @IsString() @IsNotEmpty() readonly title!: string;
  @IsString() readonly description!: string;
  @IsNumber() readonly price!: number;
  @IsString() @IsNotEmpty() readonly category!: string;
  @IsString() @IsNotEmpty() readonly sellerId!: string;
}

export class InitiateDealDto {
  @IsString() @IsNotEmpty() readonly buyerId!: string;
  @IsString() @IsNotEmpty() readonly productId!: string;
}

@Controller('products')
export class ProductController {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Получение всех активных товаров с базы для витрины всех тестеров
  @Get('list')
  async getProducts() {
    const items = await this.prisma.product.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    return {
      success: true,
      data: items.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description || '',
        priceCents: item.priceCents.toString(),
        category: item.category,
        sellerId: item.sellerId.toString(),
        status: item.status
      }))
    };
  }

  // 2. Живое создание лота без заглушек
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  async createProduct(@Body() dto: CreateProductDto) {
    const sellerIdBigInt = BigInt(dto.sellerId);
    const priceCentsBigInt = BigInt(Math.round(dto.price * 100));

    // Проверяем, существует ли продавец в БД
    const sellerExists = await this.prisma.user.findUnique({ where: { telegramId: sellerIdBigInt } });
    if (!sellerExists) throw new BadRequestException('Продавец не зарегистрирован в системе ONIX.');

    const product = await this.prisma.product.create({
      data: {
        title: dto.title,
        description: dto.description,
        priceCents: priceCentsBigInt,
        category: dto.category,
        sellerId: sellerExists.id,
        status: 'ACTIVE',
      },
    });

    return { success: true, data: product };
  }

  // 3. Покупка лота: Списание с баланса Покупателя и ХОЛД денег в сейфе Гаранта
  @Post('purchase')
  @HttpCode(HttpStatus.CREATED)
  async buyItem(@Body() dto: InitiateDealDto) {
    const buyerTgId = BigInt(dto.buyerId);

    const buyer = await this.prisma.user.findUnique({ where: { telegramId: buyerTgId } });
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });

    if (!buyer || !product) throw new BadRequestException('Неверный ID контрагента или лота.');
    if (product.status !== 'ACTIVE') throw new BadRequestException('Этот товар уже зарезервирован другим тестером.');

    if (buyer.balanceCents < product.priceCents) {
      throw new BadRequestException('Недостаточно демо-средств на вашем балансе ONIX!');
    }

    // Финтех-транзакция: Списываем деньги в холд сейфа
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: buyer.id },
        data: { balanceCents: { decrement: product.priceCents } },
      }),
      this.prisma.product.update({
        where: { id: product.id },
        data: { status: 'RESERVED' },
      }),
      this.prisma.order.create({
        data: {
          productId: product.id,
          buyerId: buyer.id,
          sellerId: product.sellerId,
          totalAmountCents: product.priceCents,
          feeCents: BigInt(Math.round(Number(product.priceCents) * 0.05)), // Скрытая маржа 5% системы ONIX
          payoutCents: product.priceCents - BigInt(Math.round(Number(product.priceCents) * 0.05)),
          status: 'PAYMENT_HOLD',
        },
      }),
    ]);

    return { success: true, message: 'Деньги успешно заморожены в Гарант-сейфе.' };
  }
}