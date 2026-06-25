import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductStatus } from '@prisma/client';
import { UserAuthUtil } from './utils/user-auth.util';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto, sellerId: string) {
    // 1. Проверяем существование пользователя через вашу утилиту findUniqueOrThrow
    const seller = await UserAuthUtil.checkUserExists(this.prisma, sellerId);

    // 2. Проверяем, привязан ли Telegram у этого продавца
    await UserAuthUtil.checkTelegramLinked(seller);

    // 3. Сохраняем товар в базу строго по вашей схеме (imageUrl останется null)
    return this.prisma.product.create({
      data: {
        title: dto.title,
        description: dto.description,
        price: dto.price,
        quantity: dto.quantity,
        category: dto.category, // Сюда безопасно запишется строка 'standoff-gold' или 'roblox-robux'
        sellerId: sellerId,
        status: ProductStatus.ACTIVE, // Автоматически выставляем статус ACTIVE из вашего enum
      },
      // Избегаем мусора в ответе: возвращаем фронтенду только самые важные поля сделки
      select: {
        id: true,
        title: true,
        price: true,
        createdAt: true,
      },
    });
  }
}