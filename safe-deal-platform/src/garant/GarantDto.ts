import { IsString, IsNotEmpty, IsNumber, Matches, Length, IsDefined, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateOrderDto {
  @IsDefined()
  @IsNotEmpty({ message: 'ID покупателя обязателен' })
  @IsString()
  @Length(5, 20, { message: 'ID покупателя: некорректная длина Telegram ID' })
  @Matches(/^\d+$/, { message: 'ID покупателя должен содержать только цифры' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value)))
  buyerId!: string;

  @IsDefined()
  @IsNotEmpty({ message: 'ID товара обязателен' })
  @IsString()
  // CUID2 от Prisma имеет длину ~24 символа, даём запас
  @Length(20, 36, { message: 'Некорректный формат ID товара' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value)))
  productId!: string;
}

export class ConfirmDeliveryDto {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d+$/)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value)))
  sellerId!: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d+$/)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value)))
  orderId!: string;
}

export class CompleteOrderDto {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d+$/)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value)))
  buyerId!: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d+$/)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value)))
  orderId!: string;
}

export class RequestWithdrawalDto {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @Length(5, 20)
  @Matches(/^\d+$/, { message: 'userId должен содержать только цифры' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value)))
  userId!: string;

  @IsDefined()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(100, { message: 'Минимальная сумма вывода — 100 рублей' })
  @Transform(({ value }) => {
    const num = parseFloat(value);
    return isNaN(num) ? 0 : Math.round(num * 100) / 100;
  })
  amountRubles!: number;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @Length(16, 64, { message: 'Ключ идемпотентности: некорректная длина' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value)))
  idempotencyKey!: string;
}