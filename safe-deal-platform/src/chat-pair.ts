import { Prisma } from '@prisma/client';

/** Deterministic personal-chat pair key — unique in DB (`Chat.pairKey`). */
export function pairChatKey(a: bigint, b: bigint): string {
  return a < b ? `d:${a}:${b}` : `d:${b}:${a}`;
}

/**
 * Find or create the single personal chat for a user pair inside an open transaction.
 * Locking both users in stable order serializes pair creation without trying to recover
 * from P2002 inside an already-aborted PostgreSQL transaction.
 */
export async function ensurePairChat(
  tx: Prisma.TransactionClient,
  userA: bigint,
  userB: bigint,
): Promise<{ id: string }> {
  if (userA === userB) {
    throw new Error('pair chat requires two distinct users');
  }
  const first = userA < userB ? userA : userB;
  const second = userA < userB ? userB : userA;
  await tx.$queryRaw`
    SELECT "id"
    FROM "User"
    WHERE "id" IN (${first}, ${second})
    ORDER BY "id"
    FOR UPDATE
  `;
  const pairKey = pairChatKey(userA, userB);
  const existing = await tx.chat.findUnique({ where: { pairKey } });
  if (existing) {
    await tx.chatMember.upsert({
      where: { chatId_userId: { chatId: existing.id, userId: userA } },
      create: { chatId: existing.id, userId: userA },
      update: {},
    });
    await tx.chatMember.upsert({
      where: { chatId_userId: { chatId: existing.id, userId: userB } },
      create: { chatId: existing.id, userId: userB },
      update: {},
    });
    return existing;
  }
  return tx.chat.create({
    data: {
      pairKey,
      members: { create: [{ userId: userA }, { userId: userB }] },
    },
  });
}
