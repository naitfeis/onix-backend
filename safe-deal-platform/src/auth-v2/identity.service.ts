import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { BAN_CLEAR_DATA, banPublicInfo, isBanActive } from '../ban-policy';
import { dualWriteTelegramIdentity, isDualWriteIdentityEnabled } from '../identity-link';
import { resolveIsSupport } from '../common';
import { RiskScoreService, type RiskDeviceInput } from '../risk-score.service';
import { AuthPlatformError } from './auth-errors';
import type { VerifiedTelegramIdentity } from './telegram-login.verifier';

@Injectable()
export class IdentityService {
  constructor(private readonly risk: RiskScoreService) {}

  async upsertTelegramUser(
    tx: Prisma.TransactionClient,
    identity: VerifiedTelegramIdentity,
    device?: RiskDeviceInput | null,
  ): Promise<User> {
    // Canonical lookup: User.telegramId. Secondary: IdentityLink (guards against
    // split-brain if a future Google/link path writes IdentityLink first).
    let existing = await tx.user.findUnique({ where: { telegramId: identity.telegramId } });
    if (!existing && isDualWriteIdentityEnabled()) {
      const link = await tx.identityLink.findFirst({
        where: {
          provider: 'TELEGRAM',
          providerUserId: identity.telegramId.toString(),
          deletedAt: null,
        },
        include: { user: true },
      });
      if (link?.user && !link.user.deletedAt) {
        // Same Telegram factor already belongs to an account — never mint a duplicate.
        existing = link.user;
        if (link.user.telegramId !== identity.telegramId) {
          throw new AuthPlatformError(
            'AUTH_IDENTITY_CONFLICT',
            'This Telegram account is already linked to another ONIX profile.',
          );
        }
      }
    }
    if (existing?.deletedAt) {
      if (!isBanActive(existing)) {
        existing = await tx.user.update({ where: { id: existing.id }, data: { ...BAN_CLEAR_DATA } });
      } else {
        throw new AuthPlatformError(
          'AUTH_ACCOUNT_LOCKED',
          'Account is locked.',
          { ban: banPublicInfo(existing) },
        );
      }
    }

    const loggedInAt = new Date();
    const displayName = [identity.firstName, identity.lastName].filter(Boolean).join(' ') || undefined;

    let user: User;
    if (existing) {
      const bootstrapAdmin = process.env.ADMIN_TELEGRAM_ID === identity.telegramId.toString();
      const isAdmin = existing.isAdmin || bootstrapAdmin;
      const isSupport = resolveIsSupport(existing.telegramId, isAdmin);
      const promoteSuper = bootstrapAdmin && existing.platformStatus !== 'SUPER_ADMIN';
      user = await tx.user.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: loggedInAt,
          lastLoginAt: loggedInAt,
          ...(promoteSuper ? {
            isAdmin: true,
            isSupport: true,
            platformStatus: 'SUPER_ADMIN',
            permissionVersion: { increment: 1 },
          } : {}),
          ...(existing.isSupport !== isSupport && !promoteSuper ? { isSupport } : {}),
          ...(identity.username !== undefined && identity.username !== existing.telegramNick
            ? { telegramNick: identity.username } : {}),
          ...(identity.firstName !== undefined && identity.firstName !== existing.firstName
            ? { firstName: identity.firstName } : {}),
          ...(identity.lastName !== undefined && identity.lastName !== existing.lastName
            ? { lastName: identity.lastName } : {}),
          ...(displayName && displayName !== existing.displayName ? { displayName } : {}),
          ...(identity.photoUrl !== undefined && identity.photoUrl !== existing.avatarUrl
            ? { avatarUrl: identity.photoUrl } : {}),
        },
      });
    } else {
      await this.risk.assertNewRegistrationAllowed(tx, {
        telegramId: identity.telegramId,
        device,
      });
      const isAdmin = process.env.ADMIN_TELEGRAM_ID === identity.telegramId.toString();
      const isSupport = resolveIsSupport(identity.telegramId, isAdmin);
      const created = await tx.user.create({
        data: {
          telegramId: identity.telegramId,
          onixId: `PENDING-${identity.telegramId}`,
          telegramNick: identity.username,
          firstName: identity.firstName,
          lastName: identity.lastName,
          displayName,
          avatarUrl: identity.photoUrl,
          lastSeenAt: loggedInAt,
          lastLoginAt: loggedInAt,
          isAdmin,
          isSupport,
          platformStatus: isAdmin ? 'SUPER_ADMIN' : isSupport ? 'MODERATOR' : 'USER',
        },
      });
      user = await tx.user.update({
        where: { id: created.id },
        data: { onixId: `ONIX-${created.id.toString().padStart(6, '0')}` },
      });
    }

    if (isDualWriteIdentityEnabled()) {
      try {
        await dualWriteTelegramIdentity(tx, {
          userId: user.id,
          telegramId: user.telegramId,
          username: identity.username !== undefined ? identity.username : user.telegramNick,
          displayName: user.displayName,
          avatarUrl: identity.photoUrl !== undefined ? identity.photoUrl : user.avatarUrl,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('AUTH_IDENTITY_CONFLICT')) {
          throw new AuthPlatformError(
            'AUTH_IDENTITY_CONFLICT',
            'This Telegram account is already linked to another ONIX profile.',
          );
        }
        throw error;
      }
    }

    await tx.identityHistory.create({
      data: {
        userId: user.id,
        provider: 'TELEGRAM',
        providerUserId: identity.telegramId.toString(),
        action: existing ? 'PROFILE_REFRESHED' : 'LINKED',
        metadata: { source: 'auth_v2_login' },
      },
    });

    return user;
  }
}
