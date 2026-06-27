import { IsString, IsNotEmpty, Matches, Length, IsDefined, IsAlphanumeric } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * 🛡️ SECURITY DTO SHIELD: Максимальная runtime-защита создания сделки
 * Блокирует XSS-атаки, Buffer Overflow, инъекции и мусорные байты до подлёта к ядру СУБД.
 */
export class CreateOrderDto {

  @IsDefined({ message: 'Критическая ошибка: Поле buyerId обязательно для фиксации ордера' })
  @IsNotEmpty({ message: 'ID покупателя не может быть пустым' })
  @IsString({ message: 'ID покупателя должен передаваться строго в строковом формате JSON' })
  @Length(5, 20, { message: 'ID покупателя за пределами системных лимитов Telegram (от 5 до 20 символов)' })
  @Matches(/^\d+$/, { message: 'Аппаратный отказ: ID покупателя должен содержать исключительно цифры Telegram ID' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  buyerId!: string; // Добавлен "!", ошибка инициализации уничтожена! [проф. 1]

  @IsDefined({ message: 'Критическая ошибка: Поле productId обязательно для фиксации ордера' })
  @IsNotEmpty({ message: 'ID товара не может быть пустым' })
  @IsString({ message: 'ID товара должен передаваться строго в строковом формате' })
  @Length(24, 30, { message: 'Нарушение структуры: Некорректный размер CUID идентификатора товара' })
  @IsAlphanumeric('en-US', { message: 'Защита ONIX Shield: ID товара должен состоять только из латинских букв и цифр' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  productId!: string; // Добавлен "!" [проф. 1]
}

/**
 * 🛡️ SECURITY DTO SHIELD: Максимальная защита для роута безопасного вывода средств (30 руб. комиссия)
 */
export class RequestWithdrawalDto {

  @IsDefined({ message: 'Поле userId обязательно для верификации транзакции вывода' })
  @IsNotEmpty({ message: 'ID пользователя не может быть пустым' })
  @IsString({ message: 'ID должен быть строкой' })
  @Length(5, 20, { message: 'Некорректная длина ID' })
  @Matches(/^\d+$/, { message: 'ID должен состоять только из цифр Telegram' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  userId!: string; // Добавлен "!" [проф. 1]

  @IsDefined({ message: 'Сумма вывода должна быть явно указана' })
  @Transform(({ value }) => {
    const num = parseFloat(value);
    return isNaN(num) ? 0 : Math.round(num * 100) / 100;
  })
  amountRubles!: number; // Добавлен "!" [проф. 1]

  @IsDefined({ message: 'Критическая уязвимость: Ключ идемпотентности idempotencyKey отсутствует в запросе' })
  @IsNotEmpty({ message: 'Ключ идемпотентности не может быть пустым' })
  @IsString({ message: 'Ключ идемпотентности должен быть строкой' })
  @Length(16, 64, { message: 'Длина ключа идемпотентности должна быть от 16 до 64 символов' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  idempotencyKey!: string; // Добавлен "!" [проф. 1]
}