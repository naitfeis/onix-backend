import { Controller, Post, Body, Req, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator'; // Бронированная валидация входящих пакетов
import { ProductService, DealInitiatedDto, OrderExecutionDto } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { OrderStatus } from '@prisma/client';

// =====================================================================
// 👑 STABLE ENTERPRISE DTO: RUNTIME ВАЛИДАЦИЯ ПАРАМЕТРОВ С УЧЕТОМ TS2564
// =====================================================================
export class InitiateDealDto {
  @IsString()
  @IsNotEmpty({ message: 'Идентификатор покупателя (buyerId) не может быть пустым' })
  readonly buyerId!: string; // Исправлено оператором !

  @IsString()
  @IsNotEmpty({ message: 'Идентификатор товара (productId) не может быть пустым' })
  readonly productId!: string; // Исправлено оператором !
}

export class ConfirmDeliveryDto {
  @IsString()
  @IsNotEmpty({ message: 'Идентификатор продавца (sellerId) не может быть пустым' })
  readonly sellerId!: string; // Исправлено оператором !

  @IsString()
  @IsNotEmpty({ message: 'Идентификатор ордера (orderId) не может быть пустым' })
  readonly orderId!: string; // Исправлено оператором !
}

export class CompleteOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'Идентификатор покупателя (buyerId) не может быть пустым' })
  readonly buyerId!: string; // Исправлено оператором !

  @IsString()
  @IsNotEmpty({ message: 'Идентификатор ордера (orderId) не может быть пустым' })
  readonly orderId!: string; // Исправлено оператором !
}

// ПАТТЕРН УНИФИКАЦИИ ОТВЕТОВ: ИДЕАЛЬНЫЙ СТАНДАРТ ДЛЯ REACT-ФРОНТЕНДА
export class OnixApiResponse<T> {
  constructor(
    public readonly success: boolean,
    public readonly data: T,
    public readonly timestamp: string = new Date().toISOString()
  ) {}
}

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  /**
   * СЕНИОР API: Выставление товара на витрину маркетплейса
   */
  @Post('create')
  @HttpCode(HttpStatus.CREATED) // Явный статус 201 Created для генерации ресурсов
  async createProduct(@Req() req: any, @Body() dto: CreateProductDto) {
    const sellerId = req.user?.id || '1';
    const result = await this.productService.create(dto, sellerId);
    return new OnixApiResponse(true, result);
  }

  /**
   * 🔥 СТАФФ-ИНЖЕНЕР ФАЗА 1: Заморозка в hold-сейфе СУБД // Возвращает 201 Created
   */
  @Post('purchase')
  @HttpCode(HttpStatus.CREATED)
  async buyItem(@Body() dto: InitiateDealDto): Promise<OnixApiResponse<DealInitiatedDto>> {
    const buyerId = this.safeParseBigInt(dto.buyerId, 'buyerId');
    const result = await this.productService.initiateP2PDeal(buyerId, dto.productId);
    return new OnixApiResponse(true, result);
  }

  /**
   * 🔥 СТАФФ-ИНЖЕНЕР ФАЗА 2: Продавец подтверждает передачу вещей в игре // Статус 200 OK
   */
  @Post('confirm-delivery')
  @HttpCode(HttpStatus.OK)
  async confirmDelivery(@Body() dto: ConfirmDeliveryDto): Promise<OnixApiResponse<{ success: boolean; status: OrderStatus }>> {
    const sellerId = this.safeParseBigInt(dto.sellerId, 'sellerId');
    const orderId = this.safeParseBigInt(dto.orderId, 'orderId');
    const result = await this.productService.confirmDelivery(sellerId, orderId);
    return new OnixApiResponse(true, result);
  }

  /**
   * 🔥 СТАФФ-ИНЖЕНЕР ФАЗА 3: Финал Гаранта и моментальная автоматическая выплата на карту
   */
  @Post('complete-instant')
  @HttpCode(HttpStatus.OK)
  async completeInstantOrder(@Body() dto: CompleteOrderDto): Promise<OnixApiResponse<OrderExecutionDto>> {
    const buyerId = this.safeParseBigInt(dto.buyerId, 'buyerId');
    const orderId = this.safeParseBigInt(dto.orderId, 'orderId');
    const result = await this.productService.completeOrderAndInstantWithdraw(buyerId, orderId);
    return new OnixApiResponse(true, result);
  }

  // =====================================================================
  // 🛡️ СЛУЖЕБНЫЙ КЛИРИНГ-МЕТОД: Предотвращение падения Node.js
  // =====================================================================
  private safeParseBigInt(value: string, fieldName: string): bigint {
    try {
      if (!value || typeof value !== 'string') throw new Error();
      return BigInt(value.trim());
    } catch (e) {
      throw new BadRequestException(
        `[🚨 API VALIDATION FAILURE]: Невалидный формат данных. Поле '${fieldName}' должно быть числовой строкой для BigInt. Сбой значения: '${value}'`,
      );
    }
  }
}