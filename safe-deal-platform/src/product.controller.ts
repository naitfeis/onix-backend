import {
  Controller, Get, Post, Body, Query,
  BadRequestException, HttpCode, HttpStatus,
} from '@nestjs/common';
import { IsString, IsNotEmpty, IsNumber, Matches, Length, IsDefined, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';

// ─── DTO прямо здесь — никаких лишних папок ─────────────────────────────────

class CreateOrderDto {
  @IsDefined() @IsNotEmpty() @IsString()
  @Length(5, 20) @Matches(/^\d+$/)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : String(value)))
  buyerId!: string;

  @IsDefined() @IsNotEmpty() @IsString()
  @Length(20, 36)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : String(value)))
  productId!: string;
}

class ConfirmDeliveryDto {
  @IsDefined() @IsNotEmpty() @IsString() @Matches(/^\d+$/)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : String(value)))
  sellerId!: string;

  @IsDefined() @IsNotEmpty() @IsString() @Matches(/^\d+$/)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : String(value)))
  orderId!: string;
}

class CompleteOrderDto {
  @IsDefined() @IsNotEmpty() @IsString() @Matches(/^\d+$/)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : String(value)))
  buyerId!: string;

  @IsDefined() @IsNotEmpty() @IsString() @Matches(/^\d+$/)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : String(value)))
  orderId!: string;
}

class RequestWithdrawalDto {
  @IsDefined() @IsNotEmpty() @IsString()
  @Length(5, 20) @Matches(/^\d+$/)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : String(value)))
  userId!: string;

  @IsDefined() @IsNumber({ maxDecimalPlaces: 2 }) @Min(100)
  @Transform(({ value }: { value: unknown }) => {
    const num = parseFloat(String(value));
    return isNaN(num) ? 0 : Math.round(num * 100) / 100;
  })
  amountRubles!: number;

  @IsDefined() @IsNotEmpty() @IsString() @Length(16, 64)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : String(value)))
  idempotencyKey!: string;
}

// ─── Контроллер ──────────────────────────────────────────────────────────────

class ApiResponse<T> {
  readonly success = true;
  constructor(public readonly data: T) {}
}

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  // GET /api/products?category=STEAM
  @Get()
  async getProducts(@Query('category') category?: string) {
    return new ApiResponse(await this.productService.getProducts(category));
  }

  // POST /api/products/create
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  async createProduct(@Body() dto: CreateProductDto) {
    return new ApiResponse(await this.productService.create(dto));
  }

  // POST /api/products/purchase — Фаза 1: деньги в сейф
  @Post('purchase')
  @HttpCode(HttpStatus.CREATED)
  async purchase(@Body() dto: CreateOrderDto) {
    const buyerTgId = this.parseBigInt(dto.buyerId, 'buyerId');
    return new ApiResponse(await this.productService.initiateP2PDeal(buyerTgId, dto.productId));
  }

  // POST /api/products/confirm-delivery — Фаза 2: продавец отгрузил
  @Post('confirm-delivery')
  @HttpCode(HttpStatus.OK)
  async confirmDelivery(@Body() dto: ConfirmDeliveryDto) {
    const sellerTgId = this.parseBigInt(dto.sellerId, 'sellerId');
    const orderId    = this.parseBigInt(dto.orderId,   'orderId');
    return new ApiResponse(await this.productService.confirmDelivery(sellerTgId, orderId));
  }

  // POST /api/products/complete — Фаза 3: покупатель подтвердил
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  async completeOrder(@Body() dto: CompleteOrderDto) {
    const buyerTgId = this.parseBigInt(dto.buyerId, 'buyerId');
    const orderId   = this.parseBigInt(dto.orderId, 'orderId');
    return new ApiResponse(await this.productService.completeOrder(buyerTgId, orderId));
  }

  // POST /api/products/withdraw — вывод на карту (50 руб комиссия)
  @Post('withdraw')
  @HttpCode(HttpStatus.CREATED)
  async requestWithdrawal(@Body() dto: RequestWithdrawalDto) {
    const userTgId = this.parseBigInt(dto.userId, 'userId');
    return new ApiResponse(
      await this.productService.requestWithdrawal(userTgId, dto.amountRubles, dto.idempotencyKey)
    );
  }

  private parseBigInt(value: string, field: string): bigint {
    try {
      return BigInt(value.trim());
    } catch {
      throw new BadRequestException(`Поле '${field}' должно быть числовой строкой.`);
    }
  }
}