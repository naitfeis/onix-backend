import { createHash, randomBytes } from 'crypto';
import type { AuthProvider, Prisma, PrismaClient } from '@prisma/client';

export type IdentityDualWriteClient = Pick<PrismaClient, 'identityLink'> | Prisma.TransactionClient;

export function isDualWriteIdentityEnabled(): boolean {
  const value = process.env.AUTH_DUAL_WRITE_IDENTITY;
  if (value === undefined || value === '') return true;
  return value !== '0' && value.toLowerCase() !== 'false';
}

export function telegramProviderUserId(telegramId: bigint): string {
  return telegramId.toString();
}

/** Deterministic id for backfill/dual-write stability across retries. */
export function stableTelegramIdentityLinkId(userId: bigint, telegramId: bigint): string {
  return createHash('md5').update(`tg:${userId}:${telegramId}`).digest('hex');
}

/**
 * Upsert TELEGRAM IdentityLink for a User (Phase 1 dual-write).
 *
 * Never reassigns providerUserId to a different userId while the link is active —
 * that would silently merge/split accounts (Google-link + Telegram-login race).
 *
 * TODO(Phase 4 — soft-unlink correctness / ADR soft-delete):
 * Current `update.deletedAt: null` reactivates a soft-deleted TELEGRAM link on every
 * successful Telegram login. That preserves Phase 1–3 production behaviour (login always
 * restores the active TELEGRAM factor) and MUST NOT change until:
 *   1. Unlink API exists with "last factor" guards
 *   2. AUTH_ENFORCE_IDENTITY_LINK read-path is live
 *   3. Explicit product rule: login-after-unlink = RELINK vs reject
 * Do not clear deletedAt blindly in Phase 4; branch on unlink intent + IdentityHistory.
 */
export async function dualWriteTelegramIdentity(
  db: IdentityDualWriteClient,
  input: {
    userId: bigint;
    telegramId: bigint;
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  },
): Promise<void> {
  if (!isDualWriteIdentityEnabled()) return;

  const providerUserId = telegramProviderUserId(input.telegramId);
  const now = new Date();

  const existing = await db.identityLink.findUnique({
    where: {
      provider_providerUserId: {
        provider: 'TELEGRAM' satisfies AuthProvider,
        providerUserId,
      },
    },
  });

  if (existing && existing.userId !== input.userId && existing.deletedAt == null) {
    // Active link already owned by another account — refuse silent reassignment.
    throw new Error(
      `AUTH_IDENTITY_CONFLICT: TELEGRAM:${providerUserId} already linked to user ${existing.userId.toString()}`,
    );
  }

  await db.identityLink.upsert({
    where: {
      provider_providerUserId: {
        provider: 'TELEGRAM' satisfies AuthProvider,
        providerUserId,
      },
    },
    create: {
      id: stableTelegramIdentityLinkId(input.userId, input.telegramId),
      userId: input.userId,
      provider: 'TELEGRAM',
      providerUserId,
      username: input.username ?? undefined,
      displayName: input.displayName ?? undefined,
      avatarUrl: input.avatarUrl ?? undefined,
      linkedAt: now,
      lastUsedAt: now,
    },
    update: {
      // Keep userId stable for active links; only reclaim soft-deleted links for same user.
      ...(existing?.deletedAt != null || !existing ? { userId: input.userId } : {}),
      username: input.username === undefined ? undefined : input.username,
      displayName: input.displayName === undefined ? undefined : input.displayName,
      avatarUrl: input.avatarUrl === undefined ? undefined : input.avatarUrl,
      lastUsedAt: now,
      // Runtime unchanged (Phase 1–3): soft-deleted TELEGRAM links are reactivated on login.
      // See TODO(Phase 4 — soft-unlink correctness) above before changing this.
      deletedAt: null,
    },
  });
}

/** Re-runnable backfill used by scripts/tests (migration also backfills). */
export async function backfillTelegramIdentityLinks(
  prisma: PrismaClient,
): Promise<{ insertedOrUpdated: number }> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      telegramId: true,
      telegramNick: true,
      displayName: true,
      avatarUrl: true,
    },
  });

  let insertedOrUpdated = 0;
  for (const user of users) {
    if (user.telegramId == null) continue;
    const before = await prisma.identityLink.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'TELEGRAM',
          providerUserId: user.telegramId.toString(),
        },
      },
    });
    await dualWriteTelegramIdentity(prisma, {
      userId: user.id,
      telegramId: user.telegramId,
      username: user.telegramNick,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    });
    if (!before) insertedOrUpdated += 1;
  }
  return { insertedOrUpdated };
}

export function newOpaqueTokenId(): string {
  return randomBytes(16).toString('hex');
}
