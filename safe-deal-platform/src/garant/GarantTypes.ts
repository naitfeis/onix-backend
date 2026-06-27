import { OrderStatus as PrismaOrderStatus } from '@prisma/client';

// 🚀 1. Синьор-решение: Нативно переиспользуем enum напрямую из сгенерированного клиента Призмы!
// Это на 100% гарантирует, что статусы в коде и в базе данных Postgres всегда будут идентичны.
export const OrderStatus = PrismaOrderStatus;
export type OrderStatus = PrismaOrderStatus;

// 🚀 2. Жесткая и точная типизация финансовой модели под High-Load копейки
export interface IDealOrder {
  id: bigint;                 // Переведено на BigInt (совпадает с базой)
  productId: string;          // ID товара из CUID
  buyerId: bigint;            // Telegram/User ID в формате BigInt
  sellerId: bigint;           // ID продавца в формате BigInt

  // Все финансовые поля переименованы в Cents и привязаны к BigInt!
  totalAmountCents: bigint;   // Полная цена лота в копейках
  feeCents: bigint;           // Твоя чистая маржа 2% системы в копейках
  payoutCents: bigint;        // Чистая выплата продавцу в копейках

  status: PrismaOrderStatus;  // Строгий статус из официального Enum базы
  createdAt: Date;
  updatedAt: Date;
}

// 📐 Дополнительный DTO-интерфейс для валидации данных, прилетающих с фронтенда
export interface CreateOrderDto {
  buyerId: string;
  productId: string;
}