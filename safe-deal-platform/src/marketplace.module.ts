import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module,
  NotFoundException, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ProductCategory, ProductStatus, ProductSubcategory, Prisma } from '@prisma/client';
import {
  IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { assertSubcategoryForCategory, SUBCATEGORIES_BY_CATEGORY } from './catalog';
import { AuthUser, CurrentUser, Public } from './common';
import { encryptDeliverySecret } from './delivery-crypto';
import { pushNewProductToFollowers } from './domain-notify';
import { PrismaService } from './prisma.service';
import { productDto } from './response';
import { fieldBadRequest } from './validation-errors';

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return Boolean(value);
}

class ProductDto {
  @IsString() @Length(5, 255) title!: string;
  @IsOptional() @IsString() @Length(0, 1500) description?: string;
  @IsString() @Matches(/^[1-9]\d*$/) priceCents!: string;
  @IsEnum(ProductCategory) category!: ProductCategory;
  @IsOptional() @IsEnum(ProductSubcategory) subcategory?: ProductSubcategory;
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) quantity!: number;
  @IsOptional() @Transform(({ value }) => toBoolean(value)) @IsBoolean() autoDeliver?: boolean;
  /** Write-only plaintext for auto-delivery. Never returned in productDto. */
  @ValidateIf((o: ProductDto) => o.autoDeliver === true)
  @IsString({ message: 'required when autoDeliver=true' })
  @Length(1, 4000, { message: 'required when autoDeliver=true' })
  deliveryText?: string;
}

class UpdateProductDto {
  @IsOptional() @IsString() @Length(5, 255) title?: string;
  @IsOptional() @IsString() @Length(0, 1500) description?: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/) priceCents?: string;
  @IsOptional() @IsEnum(ProductCategory) category?: ProductCategory;
  @IsOptional() @IsEnum(ProductSubcategory) subcategory?: ProductSubcategory;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) quantity?: number;
  @IsOptional() @Transform(({ value }) => toBoolean(value)) @IsBoolean() autoDeliver?: boolean;
  @IsOptional() @IsString() @MaxLength(4000) deliveryText?: string;
}

class ProductQuery {
  @IsOptional() @IsString() @Length(1, 100) search?: string;
  @IsOptional() @IsEnum(ProductCategory) category?: ProductCategory;
  @IsOptional() @IsEnum(ProductSubcategory) subcategory?: ProductSubcategory;
  @IsOptional() @IsString() @Matches(/^\d+$/) minPriceCents?: string;
  @IsOptional() @IsString() @Matches(/^\d+$/) maxPriceCents?: string;
  @IsOptional() @IsIn(['newest', 'price_asc', 'price_desc', 'rating']) sort: string = 'newest';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) offset = 0;
}

function deliveryFields(dto: { autoDeliver?: boolean; deliveryText?: string }) {
  const autoDeliver = Boolean(dto.autoDeliver);
  if (!autoDeliver) {
    return {
      autoDeliver: false,
      deliveryCiphertext: null as string | null,
      deliveryIv: null as string | null,
      deliveryConsumedAt: null as Date | null,
    };
  }
  const text = dto.deliveryText?.trim();
  if (!text) {
    throw fieldBadRequest('deliveryText', 'required when autoDeliver=true');
  }
  try {
    const enc = encryptDeliverySecret(text);
    return {
      autoDeliver: true,
      deliveryCiphertext: enc.ciphertext,
      deliveryIv: enc.iv,
      deliveryConsumedAt: null as Date | null,
    };
  } catch (error) {
    throw fieldBadRequest(
      'autoDeliver',
      (error as Error).message.includes('PRODUCT_DELIVERY_KEY')
        ? 'encryption key not configured (PRODUCT_DELIVERY_KEY)'
        : 'failed to encrypt deliveryText',
    );
  }
}

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  catalog() {
    return SUBCATEGORIES_BY_CATEGORY;
  }

  async list(user: AuthUser, query: ProductQuery) {
    if (
      query.minPriceCents !== undefined
      && query.maxPriceCents !== undefined
      && BigInt(query.minPriceCents) > BigInt(query.maxPriceCents)
    ) {
      throw new BadRequestException('minPriceCents не может быть больше maxPriceCents.');
    }
    if (query.category && query.subcategory) {
      try {
        assertSubcategoryForCategory(query.category, query.subcategory);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    }
    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.ACTIVE,
      ...(query.category ? { category: query.category } : {}),
      ...(query.subcategory ? { subcategory: query.subcategory } : {}),
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
      query.sort === 'price_desc' ? { priceCents: 'desc' } :
      query.sort === 'rating' ? { seller: { ratingAverage: 'desc' } } :
      { createdAt: 'desc' };
    const products = await this.prisma.product.findMany({
      where, orderBy, take: query.limit, skip: query.offset,
      include: {
        seller: {
          include: {
            _count: { select: { followers: true } },
            followers: { where: { followerId: user.id }, select: { followerId: true }, take: 1 },
          },
        },
        favorites: { where: { userId: user.id }, select: { userId: true } },
      },
    });
    return products.map((product) => productDto(product, user.id));
  }

  async get(user: AuthUser, id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        seller: {
          include: {
            _count: { select: { followers: true } },
            followers: { where: { followerId: user.id }, select: { followerId: true }, take: 1 },
          },
        },
        favorites: { where: { userId: user.id }, select: { userId: true } },
      },
    });
    if (!product) throw new NotFoundException('Товар не найден.');
    if (product.status !== ProductStatus.ACTIVE && product.sellerId !== user.id) {
      throw new NotFoundException('Товар не найден.');
    }
    return productDto(product, user.id);
  }

  async create(user: AuthUser, dto: ProductDto) {
    try {
      assertSubcategoryForCategory(dto.category, dto.subcategory);
    } catch (e) {
      throw fieldBadRequest('subcategory', (e as Error).message);
    }
    const secret = deliveryFields(dto);
    const { deliveryText: _omit, autoDeliver: _a, ...rest } = dto;
    const product = await this.prisma.product.create({
      data: {
        ...rest,
        priceCents: BigInt(dto.priceCents),
        sellerId: user.id,
        expiresAt: new Date(Date.now() + 30 * 86400_000),
        ...secret,
      },
    });
    const followers = await this.prisma.follow.findMany({
      where: { sellerId: user.id },
      select: { followerId: true, follower: { select: { telegramId: true } } },
      take: 500,
    });
    if (followers.length) {
      await this.prisma.notification.createMany({
        data: followers.map(({ followerId }) => ({
          userId: followerId, type: 'NEW_PRODUCT', title: 'Новый товар у продавца',
          body: `${product.title} · ${product.category}`, data: { productId: product.id },
        })),
      });
      void pushNewProductToFollowers(
        followers.map((f) => ({ telegramId: f.follower.telegramId })),
        product,
      );
    }
    return this.get(user, product.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateProductDto) {
    const item = await this.ownedActive(user, id);
    const category = dto.category ?? item.category;
    const subcategory = dto.subcategory !== undefined ? dto.subcategory : item.subcategory;
    try {
      assertSubcategoryForCategory(category, subcategory);
    } catch (e) {
      throw fieldBadRequest('subcategory', (e as Error).message);
    }
    const { priceCents, deliveryText, autoDeliver, ...data } = dto;
    const patch: Prisma.ProductUpdateInput = {
      ...data,
      ...(priceCents ? { priceCents: BigInt(priceCents) } : {}),
    };
    if (autoDeliver !== undefined || deliveryText !== undefined) {
      if (item.deliveryConsumedAt) {
        throw fieldBadRequest('deliveryText', 'already consumed and cannot be changed');
      }
      const wantAuto = autoDeliver ?? item.autoDeliver;
      if (!wantAuto) {
        Object.assign(patch, {
          autoDeliver: false,
          deliveryCiphertext: null,
          deliveryIv: null,
          deliveryConsumedAt: null,
        });
      } else if (deliveryText?.trim()) {
        Object.assign(patch, deliveryFields({ autoDeliver: true, deliveryText }));
      } else if (item.deliveryCiphertext && item.deliveryIv) {
        Object.assign(patch, { autoDeliver: true });
      } else {
        throw fieldBadRequest('deliveryText', 'required when autoDeliver=true');
      }
    }
    await this.prisma.product.update({ where: { id }, data: patch });
    return this.get(user, id);
  }

  async status(user: AuthUser, id: string, status: 'ACTIVE' | 'ARCHIVED') {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.sellerId !== user.id) throw new NotFoundException('Товар не найден.');
    if (product.status === 'RESERVED') throw new BadRequestException('Товар участвует в сделке.');
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { status, ...(status === 'ACTIVE' ? { publishedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400_000) } : {}) },
      });
      // Favorites policy: archived listings are removed (not shown as «Недоступен»).
      if (status === 'ARCHIVED') {
        await tx.favorite.deleteMany({ where: { productId: id } });
      }
    });
    return this.get(user, id);
  }

  private async ownedActive(user: AuthUser, id: string) {
    const item = await this.prisma.product.findFirst({
      where: { id, sellerId: user.id, status: { in: ['ACTIVE', 'ARCHIVED'] } },
    });
    if (!item) throw new NotFoundException('Доступный для редактирования товар не найден.');
    return item;
  }
}

@Controller('products')
export class MarketplaceController {
  constructor(private readonly service: MarketplaceService) {}

  @Public()
  @Get('catalog/subcategories')
  catalog() {
    return this.service.catalog();
  }

  @Get() list(@CurrentUser() user: AuthUser, @Query() query: ProductQuery) {
    return this.service.list(user, query);
  }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: ProductDto) {
    return this.service.create(user, dto);
  }
  @Patch(':id') update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.service.update(user, id, dto);
  }
  @Post(':id/publish') publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.status(user, id, 'ACTIVE');
  }
  @Delete(':id') archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.status(user, id, 'ARCHIVED');
  }
}

@Module({ controllers: [MarketplaceController], providers: [MarketplaceService] })
export class MarketplaceModule {}
