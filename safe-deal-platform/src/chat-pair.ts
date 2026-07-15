import { Prisma } from '@prisma/client';

/** Deterministic personal-chat pair key — unique in DB (`Chat.pairKey`). */
export function pairChatKey(a: bigint, b: bigint): string {
  return a < b ? `d:${a}:${b}` : `d:${b}:${a}`;
}

/**
 * Find or create the single personal chat for a user pair inside an open transaction.
 * Caller should run under Serializable (or handle P2002) to avoid duplicates under races.
 */
export async function ensurePairChat(
  tx: Prisma.TransactionClient,
  userA: bigint,
  userB: bigint,
): Promise<{ id: string }> {
  if (userA === userB) {
    throw new Error('pair chat requires two distinct users');
  }
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
  try {
    return await tx.chat.create({
      data: {
        pairKey,
        members: { create: [{ userId: userA }, { userId: userB }] },
      },
    });
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code: string }).code === 'P2002'
    ) {
      const raced = await tx.chat.findUniqueOrThrow({ where: { pairKey } });
      await tx.chatMember.upsert({
        where: { chatId_userId: { chatId: raced.id, userId: userA } },
        create: { chatId: raced.id, userId: userA },
        update: {},
      });
      await tx.chatMember.upsert({
        where: { chatId_userId: { chatId: raced.id, userId: userB } },
        create: { chatId: raced.id, userId: userB },
        update: {},
      });
      return raced;
    }
    throw error;
  }
}
