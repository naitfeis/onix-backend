import {
  BadRequestException, Body, Controller, Delete, Get, Header, Injectable, Module, NotFoundException,
  Optional, Param, Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProductCategory, ProductStatus, ProductSubcategory, Prisma } from '@prisma/client';
import {
  IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { assertSubcategoryForCategory, matchProductCategory, PRODUCT_CATEGORIES, SUBCATEGORIES_BY_CATEGORY } from './catalog';
import { AuthUser, CurrentUser, Public } from './common';
import { DualAccessService } from './auth-v2/dual-access.service';
import { AuthModule, AuthService } from './auth.module';
import { AuthV2Module } from './auth-v2/auth-v2.module';
import { encryptDeliverySecret } from './delivery-crypto';
import { pushNewProductToFollowers } from './domain-notify';
import { onixIdLookupCandidates } from './onix-id';
import { assertListingPrice } from './pricing';
import { PrismaService } from './prisma.service';
import { RealtimeBus } from './realtime/realtime-bus.service';
import { RealtimeModule } from './realtime/realtime.module';
import {
  productDetailSelect, productListSelect, sellerCatalogSelect, sellerPublicSelect,
} from './query-selects';
import { assertRateLimit } from './rate-limit';
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
  @IsString() @Length(5, 32) title!: string;
  @IsOptional() @IsString() @MaxLength(20_000) description?: string;
  @IsString() @Matches(/^\d+$/) priceCents!: string;
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return value;
    const raw = String(value).trim();
    return matchProductCategory(raw) ?? raw.toUpperCase().replace(/[\s-]+/g, '_');
  })
  @IsIn(PRODUCT_CATEGORIES)
  category!: ProductCategory;
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
  @IsOptional() @IsString() @Length(5, 32) title?: string;
  @IsOptional() @IsString() @MaxLength(20_000) description?: string;
  @IsOptional() @IsString() @Matches(/^\d+$/) priceCents?: string;
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = String(value).trim();
    return matchProductCategory(raw) ?? raw.toUpperCase().replace(/[\s-]+/g, '_');
  })
  @IsIn(PRODUCT_CATEGORIES)
  category?: ProductCategory;
  @IsOptional() @IsEnum(ProductSubcategory) subcategory?: ProductSubcategory;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) quantity?: number;
  @IsOptional() @Transform(({ value }) => toBoolean(value)) @IsBoolean() autoDeliver?: boolean;
  @IsOptional() @IsString() @MaxLength(4000) deliveryText?: string;
}

class ProductQuery {
  @IsOptional() @IsString() @Length(1, 100) search?: string;
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '' || value === 'Все') return undefined;
    const raw = String(value).trim();
    return matchProductCategory(raw) ?? raw.toUpperCase().replace(/[\s-]+/g, '_');
  })
  @IsIn(PRODUCT_CATEGORIES)
  category?: ProductCategory;
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
        ? 'PRODUCT_DELIVERY_KEY не задан или неверный (нужен 32-byte base64). Добавьте ключ в Render Environment или локальный .env и перезапустите API.'
        : 'failed to encrypt deliveryText',
    );
  }
}

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeBus,
  ) {}

  private emitProductChanged(product: { id: string; status: string; quantity: number }, opts?: { created?: boolean }): void {
    this.realtime.publish({
      kind: 'product.changed',
      productId: product.id,
      status: product.status,
      quantity: product.quantity,
      ...(opts?.created ? { created: true } : {}),
    });
  }

  catalog() {
    return SUBCATEGORIES_BY_CATEGORY;
  }

  async list(user: AuthUser | null, query: ProductQuery) {
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
    const viewerId = user?.id ?? null;
    const searchCat = query.search && !query.category
      ? matchProductCategory(query.search)
      : undefined;
    const lotFromSearch = (() => {
      if (!query.search) return undefined;
      const m = query.search.trim().match(/^ONIXLOT-(\d+)$/i);
      if (!m) return undefined;
      const n = Number(m[1]);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    })();
    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.ACTIVE,
      ...(query.category ? { category: query.category } : {}),
      ...(query.subcategory ? { subcategory: query.subcategory } : {}),
      ...(query.search ? {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { seller: { displayName: { contains: query.search, mode: 'insensitive' } } },
          { seller: { onixId: { in: onixIdLookupCandidates(query.search) } } },
          ...(searchCat ? [{ category: searchCat }] : []),
          ...(lotFromSearch != null ? [{ lotNumber: lotFromSearch }] : []),
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
    // Lean catalog: no description, no view counts, no followers COUNT / Follow probe.
    // Single round-trip via relationLoadStrategy join (avoids parallel client.query on adapter-pg).
    const products = await this.prisma.product.findMany({
      relationLoadStrategy: 'join',
      where, orderBy, take: query.limit, skip: query.offset,
      select: {
        ...productListSelect,
        seller: { select: sellerCatalogSelect },
        ...(viewerId != null
          ? { favorites: { where: { userId: viewerId }, select: { userId: true } } }
          : {}),
      },
    });
    return products.map((product) => productDto(
      {
        ...product,
        // Omit description on lean list (undefined → not in DTO). Detail GET always includes it.
        seller: {
          ...product.seller,
          telegramNick: null,
          _count: { followers: 0 },
        },
      },
      viewerId ?? undefined,
    ));
  }

  async get(user: AuthUser | null, id: string) {
    const viewerId = user?.id ?? null;
    const product = await this.prisma.product.findUnique({
      relationLoadStrategy: 'join',
      where: { id },
      select: {
        ...productDetailSelect,
        seller: { select: sellerPublicSelect(viewerId) },
        ...(viewerId != null
          ? { favorites: { where: { userId: viewerId }, select: { userId: true } } }
          : {}),
      },
    });
    if (!product) throw new NotFoundException('Товар не найден.');
    if (product.status !== ProductStatus.ACTIVE && (viewerId == null || product.sellerId !== viewerId)) {
      throw new NotFoundException('Товар не найден.');
    }
    const viewCounts = await this.ownerViewCounts(viewerId, [product]);
    return productDto(
      {
        ...product,
        ...(viewCounts.has(product.id)
          ? { _count: { viewUniques: viewCounts.get(product.id)! } }
          : {}),
      },
      viewerId ?? undefined,
    );
  }

  /** Owner listings — ACTIVE only (archived / sold-out / reserved hidden after «Снять»). */
  async listMine(user: AuthUser, limit = 15, offset = 0) {
    const take = Math.min(Math.max(limit, 1), 50);
    const skip = Math.min(Math.max(offset, 0), 10_000);
    const products = await this.prisma.product.findMany({
      relationLoadStrategy: 'join',
      where: { sellerId: user.id, status: ProductStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: {
        ...productDetailSelect,
        seller: { select: sellerPublicSelect(user.id) },
      },
    });
    const viewCounts = await this.ownerViewCounts(user.id, products);
    return products.map((product) => productDto(
      {
        ...product,
        ...(viewCounts.has(product.id)
          ? { _count: { viewUniques: viewCounts.get(product.id)! } }
          : { _count: { viewUniques: 0 } }),
      },
      user.id,
    ));
  }

  /** Unique view counts only for products owned by the viewer (never for market peers). */
  private async ownerViewCounts(
    viewerId: bigint | null,
    products: Array<{ id: string; sellerId: bigint }>,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (viewerId == null) return out;
    const ownedIds = products.filter((p) => p.sellerId === viewerId).map((p) => p.id);
    if (!ownedIds.length) return out;
    const rows = await this.prisma.productViewUnique.groupBy({
      by: ['productId'],
      where: { productId: { in: ownedIds } },
      _count: { _all: true },
    });
    for (const row of rows) out.set(row.productId, row._count._all);
    return out;
  }

  async getByLot(user: AuthUser | null, lotNumber: number) {
    const row = await this.prisma.product.findUnique({
      where: { lotNumber },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Товар не найден.');
    return this.get(user, row.id);
  }

  async create(user: AuthUser, dto: ProductDto) {
    const seller = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { sellBannedAt: true },
    });
    if (seller?.sellBannedAt) {
      throw new BadRequestException('Продажа товаров запрещена администратором.');
    }
    try {
      assertSubcategoryForCategory(dto.category, dto.subcategory);
    } catch (e) {
      throw fieldBadRequest('subcategory', (e as Error).message);
    }
    try {
      assertListingPrice(BigInt(dto.priceCents), dto.subcategory);
    } catch (e) {
      throw fieldBadRequest('priceCents', (e as Error).message);
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
    this.emitProductChanged(
      { id: product.id, status: product.status, quantity: product.quantity },
      { created: true },
    );
    return this.get(user, product.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateProductDto) {
    const seller = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { sellBannedAt: true },
    });
    if (seller?.sellBannedAt) {
      throw new BadRequestException('Продажа товаров запрещена администратором.');
    }
    const item = await this.ownedActive(user, id);
    const category = dto.category ?? item.category;
    const subcategory = dto.subcategory !== undefined ? dto.subcategory : item.subcategory;
    try {
      assertSubcategoryForCategory(category, subcategory);
    } catch (e) {
      throw fieldBadRequest('subcategory', (e as Error).message);
    }
    const { priceCents, deliveryText, autoDeliver, ...data } = dto;
    if (priceCents) {
      try {
        assertListingPrice(BigInt(priceCents), subcategory);
      } catch (e) {
        throw fieldBadRequest('priceCents', (e as Error).message);
      }
    }
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
    const updated = await this.get(user, id);
    this.emitProductChanged({
      id: updated.id,
      status: updated.status,
      quantity: updated.quantity,
    });
    return updated;
  }

  async status(user: AuthUser, id: string, status: 'ACTIVE' | 'ARCHIVED') {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.sellerId !== user.id) throw new NotFoundException('Товар не найден.');
    if (product.status === 'RESERVED') throw new BadRequestException('Товар участвует в сделке.');
    if (status === 'ACTIVE') {
      const seller = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { sellBannedAt: true },
      });
      if (seller?.sellBannedAt) {
        throw new BadRequestException('Продажа товаров запрещена администратором.');
      }
    }
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
    const updated = await this.get(user, id);
    this.emitProductChanged({
      id: updated.id,
      status: updated.status,
      quantity: updated.quantity,
    });
    return updated;
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
  constructor(
    private readonly service: MarketplaceService,
    @Optional() private readonly dualAccess?: DualAccessService,
    @Optional() private readonly auth?: AuthService,
  ) {}

  @Public()
  @Get('catalog/subcategories')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  catalog() {
    return this.service.catalog();
  }

  /**
   * Public catalog — never 401.
   * Optional Bearer personalizes favorites/followed; invalid/missing token → guest catalog.
   * Anonymous responses are cacheable; authenticated responses stay private.
   */
  @Public()
  @Get()
  async list(
    @Req() req: { headers?: Record<string, string | string[] | undefined>; ip?: string },
    @Res({ passthrough: true }) res: Response,
    @Query() query: ProductQuery,
  ) {
    assertRateLimit(`products:list:${req.ip ?? 'unknown'}`, 90, 60_000);
    const user = await this.optionalViewer(req);
    res.setHeader(
      'Cache-Control',
      user
        ? 'private, no-store'
        : 'public, max-age=60, stale-while-revalidate=300',
    );
    return this.service.list(user, query);
  }

  /** Auth required — blocks anonymous ONIXLOT enumeration / harvesting. */
  @Get('lot/:lotNumber')
  @Header('Cache-Control', 'private, no-store')
  getByLot(
    @CurrentUser() user: AuthUser,
    @Param('lotNumber') lotNumber: string,
  ) {
    const n = Number(lotNumber);
    if (!Number.isInteger(n) || n < 1) throw new BadRequestException('Некорректный ONIXLOT.');
    return this.service.getByLot(user, n);
  }

  /** Must be before :id — owner listings with views + description. */
  @Get('mine')
  @Header('Cache-Control', 'private, no-store')
  listMine(
    @CurrentUser() user: AuthUser,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const limit = Number(limitRaw);
    const offset = Number(offsetRaw);
    return this.service.listMine(
      user,
      Number.isFinite(limit) ? limit : 15,
      Number.isFinite(offset) ? offset : 0,
    );
  }

  @Public()
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  async get(
    @Req() req: { headers?: Record<string, string | string[] | undefined>; ip?: string },
    @Param('id') id: string,
  ) {
    assertRateLimit(`products:get:${req.ip ?? 'unknown'}`, 120, 60_000);
    const user = await this.optionalViewer(req);
    return this.service.get(user, id);
  }

  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: ProductDto) {
    assertRateLimit(`product-create:${user.id}`, 20, 60_000);
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

  /** Soft auth for catalog — never throws 401. */
  private async optionalViewer(req: { headers?: Record<string, string | string[] | undefined> }): Promise<AuthUser | null> {
    const raw = req.headers?.authorization ?? req.headers?.Authorization;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value?.startsWith('Bearer ')) return null;
    const token = value.slice('Bearer '.length).trim();
    if (!token) return null;
    try {
      if (this.dualAccess?.isEdDsaAccessToken(token)) {
        if (!this.dualAccess.isAcceptEnabled()) return null;
        return await this.dualAccess.verifyEd25519AccessToken(token);
      }
      if (this.auth) return await this.auth.verifyToken(token);
    } catch {
      return null;
    }
    return null;
  }
}

@Module({
  imports: [AuthV2Module, AuthModule, RealtimeModule],
  // Product moderation lives in the separate AdminModule control plane.
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
