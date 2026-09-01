import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { withSerializableTransaction } from '../../database/transaction-retry';
import { TrustService } from '../trust/trust.service';
import { createId } from '../wallet/cuid';

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

  /** Trusted admin-plane grant — authorization and audit are enforced by its caller. */
  async grantFromAdminPlane(userId: bigint, endsAt?: Date) {
    return withSerializableTransaction(this.prisma, async (tx) => {
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
    });
  }

  /** Trusted admin-plane revoke — authorization and audit are enforced by its caller. */
  async revokeFromAdminPlane(userId: bigint) {
    return withSerializableTransaction(this.prisma, async (tx) => {
      const existing = await tx.sellerSubscription.findUnique({ where: { userId } });
      if (!existing) throw new NotFoundException('Подписка не найдена.');
      const sub = await tx.sellerSubscription.update({
        where: { userId },
        data: { status: 'CANCELED', endsAt: new Date() },
      });
      await this.trust.appendHistory(tx, userId, 'PRO_ENDED', { subscriptionId: sub.id });
      return sub;
    });
  }
}
