import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

/** Decrement ACTIVE stock under an already-held product row lock. */
export async function reserveProductStock(
  tx: Db,
  productId: string,
  quantity: number,
): Promise<{ quantityAfter: number }> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new BadRequestException('Некорректное количество.');
  }
  const reserved = await tx.product.updateMany({
    where: { id: productId, status: 'ACTIVE', quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (!reserved.count) throw new ConflictException('Товар уже зарезервирован.');
  const stockAfter = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: { quantity: true },
  });
  if (stockAfter.quantity < 1) {
    await tx.product.update({
      where: { id: productId },
      data: { status: stockAfter.quantity === 0 ? 'SOLD_OUT' : 'RESERVED' },
    });
  }
  return { quantityAfter: stockAfter.quantity };
}

/** Restore units after failed/expired checkout reservation. */
export async function releaseProductStock(
  tx: Db,
  productId: string,
  quantity: number,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 1) return;
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, status: true },
  });
  if (!product) return;
  await tx.product.update({
    where: { id: productId },
    data: {
      quantity: { increment: quantity },
      status: product.status === 'SOLD_OUT' || product.status === 'RESERVED'
        ? 'ACTIVE'
        : product.status,
    },
  });
}
