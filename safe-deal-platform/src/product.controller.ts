import { Controller, Post, Body, Req } from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post('create')
  async createProduct(@Req() req: any, @Body() dto: CreateProductDto) {
    // В будущем здесь будет извлечение id из JWT токена
    // Пока захардкодим тестовый id продавца для проверки работы
    const sellerId = req.user?.id || 'test-seller-id';

    // Передаем валидированные данные и id продавца в сервис
    return this.productService.create(dto, sellerId);
  }
}