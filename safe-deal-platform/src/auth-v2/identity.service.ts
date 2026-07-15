import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
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
    const existing = await tx.user.findUnique({ where: { telegramId: identity.telegramId } });
    if (existing?.deletedAt) {
      throw new AuthPlatformError('AUTH_ACCOUNT_LOCKED', 'Account is locked.');
    }

    const loggedInAt = new Date();
    const displayName = [identity.firstName, identity.lastName].filter(Boolean).join(' ') || undefined;

    let user: User;
    if (existing) {
      const isAdmin = existing.isAdmin;
      const isSupport = resolveIsSupport(existing.telegramId, isAdmin);
      user = await tx.user.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: loggedInAt,
          lastLoginAt: loggedInAt,
          ...(existing.isSupport !== isSupport ? { isSupport } : {}),
          ...(identity.username !== undefined && identity.username !== existing.telegramNick
            ? { telegramNick: identity.username } : {}),
          ...(identity.firstName !== undefined && identity.firstName !== existing.firstName
            ? { firstName: identity.firstName } : {}),
          ...(identity.lastName !== undefined && identity.lastName !== existing.lastName
            ? { lastName: identity.lastName } : {}),
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
          isSupport: resolveIsSupport(identity.telegramId, isAdmin),
        },
      });
      user = await tx.user.update({
        where: { id: created.id },
        data: { onixId: `ONIX-${created.id.toString().padStart(6, '0')}` },
      });
    }

    if (isDualWriteIdentityEnabled()) {
      await dualWriteTelegramIdentity(tx, {
        userId: user.id,
        telegramId: user.telegramId,
        username: identity.username !== undefined ? identity.username : user.telegramNick,
        displayName: user.displayName,
        avatarUrl: identity.photoUrl !== undefined ? identity.photoUrl : user.avatarUrl,
      });
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
