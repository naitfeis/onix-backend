import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient | {
  userBlock: {
    findFirst: (args: {
      where: {
        OR: Array<{ blockerId: bigint; blockedId: bigint }>;
      };
      select?: { blockerId?: boolean };
    }) => Promise<{ blockerId: bigint } | null>;
  };
};

/** True if either user has blocked the other. */
export async function areUsersBlocked(db: Db, a: bigint, b: bigint): Promise<boolean> {
  if (a === b) return false;
  const row = await db.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { blockerId: true },
  });
  return Boolean(row);
}

export async function assertUsersNotBlocked(
  db: Db,
  a: bigint,
  b: bigint,
  message = 'Действие недоступно: пользователь в чёрном списке.',
): Promise<void> {
  if (await areUsersBlocked(db, a, b)) {
    throw new BadRequestException(message);
  }
}

/** Drop recipients who have a block relationship with `actorId`. */
export async function filterUnblockedRecipients(
  db: {
    userBlock: {
      findMany: (args: {
        where: {
          OR: Array<
            | { blockerId: bigint; blockedId: { in: bigint[] } }
            | { blockedId: bigint; blockerId: { in: bigint[] } }
          >;
        };
        select: { blockerId: true; blockedId: true };
      }) => Promise<Array<{ blockerId: bigint; blockedId: bigint }>>;
    };
  },
  actorId: bigint,
  recipientIds: bigint[],
): Promise<bigint[]> {
  if (!recipientIds.length) return [];
  const blocks = await db.userBlock.findMany({
    where: {
      OR: [
        { blockerId: actorId, blockedId: { in: recipientIds } },
        { blockedId: actorId, blockerId: { in: recipientIds } },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  if (!blocks.length) return recipientIds;
  const blocked = new Set<string>();
  for (const row of blocks) {
    const other = row.blockerId === actorId ? row.blockedId : row.blockerId;
    blocked.add(other.toString());
  }
  return recipientIds.filter((id) => !blocked.has(id.toString()));
}
