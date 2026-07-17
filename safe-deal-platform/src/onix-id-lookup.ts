import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { onixIdLookupCandidates } from './onix-id';

type Db = Pick<PrismaClient, 'user'>;

/** Resolve user by ONIX-1 / ONIX-000001 / bare digits without changing stored primary key. */
export async function findUserByOnixId(prisma: Db, raw: string) {
  const candidates = onixIdLookupCandidates(raw);
  if (candidates.length === 0) return null;
  return prisma.user.findFirst({
    where: {
      OR: candidates.map((onixId) => ({ onixId })),
      deletedAt: null,
    },
  });
}

export async function requireUserByOnixId(prisma: Db, raw: string) {
  const user = await findUserByOnixId(prisma, raw);
  if (!user) throw new NotFoundException('Пользователь не найден.');
  return user;
}
