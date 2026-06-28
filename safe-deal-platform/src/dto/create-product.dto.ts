import { IsEnum, IsNumber, IsInt, IsOptional, IsString, Min, Max, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { CategoryType } from './category.enum';

export class CreateProductDto {
  @IsString()
  @Length(5, 80, { message: 'Название товара должно быть от 5 до 80 символов' })
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000, { message: 'Описание не может превышать 1000 символов' })
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Цена должна быть числом с не более чем 2 знаками после запятой' })
  @Min(10, { message: 'Минимальная цена лота — 10 рублей' })
  @Max(50000, { message: 'Максимальная цена лота — 50 000 рублей' })
  price!: number;

  @IsInt({ message: 'Количество должно быть целым числом' })
  @Min(1, { message: 'Количество товара не может быть меньше 1' })
  quantity!: number;

  @IsEnum(CategoryType, { message: `Категория должна быть одной из: ${Object.values(CategoryType).join(', ')}` })
  category!: CategoryType;

  // sellerId прилетает с фронтенда как строка Telegram ID
  @IsString()
  @Length(5, 20)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value)))
  sellerId!: string;
}