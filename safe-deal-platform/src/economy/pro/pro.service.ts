import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common';
import { PrismaService } from '../../prisma.service';
import { TrustService } from '../trust/trust.service';
import { createId } from '../wallet/cuid';

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

/**
 * ONIX PRO commercial subscription — independent of Trust Score / Level.
 * Granting PRO must never mutate trustScore or trustLevel.
 */
@Injectable()
export class ProSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trust: TrustService,
  ) {}

  async getStatus(userId: bigint) {
    const sub = await this.prisma.sellerSubscription.findUnique({ where: { userId } });
    if (!sub) return { active: false as const, plan: null, endsAt: null };
    const active = sub.status === 'ACTIVE' && (!sub.endsAt || sub.endsAt > new Date());
    return {
      active,
      plan: sub.plan,
      status: sub.status,
      startsAt: sub.startsAt.toISOString(),
      endsAt: sub.endsAt?.toISOString() ?? null,
    };
  }

  /** Admin/ops grant — commercial only. */
  async grant(actor: AuthUser, userId: bigint, endsAt?: Date) {
    if (!actor.isAdmin) throw new ForbiddenException('Только администратор.');
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.sellerSubscription.upsert({
        where: { userId },
        create: {
          id: createId(),
          userId,
          plan: 'PRO',
          status: 'ACTIVE',
          endsAt: endsAt ?? null,
        },
        update: {
          status: 'ACTIVE',
          startsAt: new Date(),
          endsAt: endsAt ?? null,
        },
      });
      // History for transparency — does NOT affect Trust Score formula.
      await this.trust.appendHistory(tx, userId, 'PRO_GRANTED', {
        subscriptionId: sub.id,
        endsAt: sub.endsAt?.toISOString() ?? null,
      });
      return sub;
    }, SERIALIZABLE);
  }

  async revoke(actor: AuthUser, userId: bigint) {
    if (!actor.isAdmin) throw new ForbiddenException('Только администратор.');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.sellerSubscription.findUnique({ where: { userId } });
      if (!existing) throw new NotFoundException('Подписка не найдена.');
      const sub = await tx.sellerSubscription.update({
        where: { userId },
        data: { status: 'CANCELED', endsAt: new Date() },
      });
      await this.trust.appendHistory(tx, userId, 'PRO_ENDED', { subscriptionId: sub.id });
      return sub;
    }, SERIALIZABLE);
  }
}
