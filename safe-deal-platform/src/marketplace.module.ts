import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module,
  NotFoundException, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ProductCategory, ProductStatus, Prisma } from '@prisma/client';
import {
  IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min,
} from 'class-validator';
import { AuthUser, CurrentUser } from './common';
import { PrismaService } from './prisma.service';
import { productDto } from './response';

class ProductDto {
  @IsString() @Length(5, 255) title!: string;
  @IsOptional() @IsString() @Length(0, 1500) description?: string;
  @IsString() @Matches(/^[1-9]\d*$/) priceCents!: string;
  @IsEnum(ProductCategory) category!: ProductCategory;
  @IsOptional() @IsString() @Length(1, 100) subcategory?: string;
  @IsInt() @Min(1) @Max(10000) quantity!: number;
}

class UpdateProductDto {
  @IsOptional() @IsString() @Length(5, 255) title?: string;
  @IsOptional() @IsString() @Length(0, 1500) description?: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/) priceCents?: string;
  @IsOptional() @IsEnum(ProductCategory) category?: ProductCategory;
  @IsOptional() @IsString() @Length(1, 100) subcategory?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10000) quantity?: number;
}

class ProductQuery {
  @IsOptional() @IsString() @Length(1, 100) search?: string;
  @IsOptional() @IsEnum(ProductCategory) category?: ProductCategory;
  @IsOptional() @IsString() @Matches(/^\d+$/) minPriceCents?: string;
  @IsOptional() @IsString() @Matches(/^\d+$/) maxPriceCents?: string;
  @IsOptional() @IsIn(['newest', 'price_asc', 'price_desc']) sort: string = 'newest';
  @IsOptional() @IsInt() @Min(1) @Max(100) limit = 30;
}

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ProductQuery) {
    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.ACTIVE,
      ...(query.category ? { category: query.category } : {}),
      ...(query.search ? {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { seller: { telegramNick: { contains: query.search, mode: 'insensitive' } } },
          { seller: { onixId: { equals: query.search, mode: 'insensitive' } } },
        ],
      } : {}),
      ...((query.minPriceCents || query.maxPriceCents) ? {
        priceCents: {
          ...(query.minPriceCents ? { gte: BigInt(query.minPriceCents) } : {}),
          ...(query.maxPriceCents ? { lte: BigInt(query.maxPriceCents) } : {}),
        },
      } : {}),
    };
    const orderBy: Prisma.ProductOrderByWithRelationInput =
      query.sort === 'price_asc' ? { priceCents: 'asc' } :
      query.sort === 'price_desc' ? { priceCents: 'desc' } : { createdAt: 'desc' };
    const products = await this.prisma.product.findMany({
      where, orderBy, take: query.limit,
      include: {
        seller: { include: { _count: { select: { followers: true } } } },
        favorites: { where: { userId: user.id }, select: { userId: true } },
      },
    });
    return products.map((product) => productDto(product, user.id));
  }

  async get(user: AuthUser, id: string) {
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: {
        seller: { include: { _count: { select: { followers: true } } } },
        favorites: { where: { userId: user.id }, select: { userId: true } },
      },
    });
    return productDto(product, user.id);
  }

  async create(user: AuthUser, dto: ProductDto) {
    const product = await this.prisma.product.create({
      data: {
        ...dto, priceCents: BigInt(dto.priceCents), sellerId: user.id,
        expiresAt: new Date(Date.now() + 30 * 86400_000),
      },
    });
    const followers = await this.prisma.follow.findMany({ where: { sellerId: user.id }, select: { followerId: true } });
    if (followers.length) {
      await this.prisma.notification.createMany({
        data: followers.map(({ followerId }) => ({
          userId: followerId, type: 'NEW_PRODUCT', title: 'Новый товар',
          body: product.title, data: { productId: product.id },
        })),
      });
    }
    return this.get(user, product.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateProductDto) {
    await this.ownedActive(user, id);
    const { priceCents, ...data } = dto;
    await this.prisma.product.update({
      where: { id },
      data: { ...data, ...(priceCents ? { priceCents: BigInt(priceCents) } : {}) },
    });
    return this.get(user, id);
  }

  async status(user: AuthUser, id: string, status: 'ACTIVE' | 'ARCHIVED') {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.sellerId !== user.id) throw new NotFoundException('Товар не найден.');
    if (product.status === 'RESERVED') throw new BadRequestException('Товар участвует в сделке.');
    await this.prisma.product.update({
      where: { id },
      data: { status, ...(status === 'ACTIVE' ? { publishedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400_000) } : {}) },
    });
    return this.get(user, id);
  }

  private async ownedActive(user: AuthUser, id: string) {
    const item = await this.prisma.product.findFirst({ where: { id, sellerId: user.id, status: { in: ['ACTIVE', 'ARCHIVED'] } } });
    if (!item) throw new NotFoundException('Доступный для редактирования товар не найден.');
    return item;
  }
}

@Controller('products')
export class MarketplaceController {
  constructor(private readonly service: MarketplaceService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query() query: ProductQuery) { return this.service.list(user, query); }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.get(user, id); }
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: ProductDto) { return this.service.create(user, dto); }
  @Patch(':id') update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.service.update(user, id, dto);
  }
  @Post(':id/publish') publish(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.status(user, id, 'ACTIVE'); }
  @Delete(':id') archive(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.status(user, id, 'ARCHIVED'); }
}

@Module({ controllers: [MarketplaceController], providers: [MarketplaceService] })
export class MarketplaceModule {}
