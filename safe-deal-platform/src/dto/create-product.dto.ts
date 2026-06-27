import { IsEnum, IsNumber, IsInt, Min, Max, Length } from 'class-validator';
import { CategoryType } from './category.enum';

export class CreateProductDto {
  @Length(5, 80, { message: 'Название товара должно быть от 5 до 80 символов' })
  title!: string;

  @Length(10, 1000, { message: 'Описание должно быть от 10 до 1000 символов' })
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Цена должна быть числом' })
  @Min(1, { message: 'Минимальная цена — 1 рубль' })
  @Max(999999.99, { message: 'Цена превышает лимит базы данных' })
  price!: number;

  @IsInt({ message: 'Количество должно быть целым числом' })
  @Min(1, { message: 'Количество товара не может быть меньше 1' })
  quantity!: number;

  @IsEnum(CategoryType, { message: 'Выбранная категория не поддерживается' })
  category!: CategoryType;
}