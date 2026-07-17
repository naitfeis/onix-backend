import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { SellerVerificationKind, SellerVerificationStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../../common';
import { PrismaService } from '../../prisma.service';
import { TrustService } from '../trust/trust.service';
import { createId } from '../wallet/cuid';

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

const HISTORY_BY_KIND: Partial<Record<SellerVerificationKind, 'PHONE_VERIFIED' | 'PASSPORT_VERIFIED' | 'VOICE_VERIFIED'>> = {
  PHONE_SMS: 'PHONE_VERIFIED',
  PHONE_CALL: 'PHONE_VERIFIED',
  PHONE_VOICE: 'PHONE_VERIFIED',
  PASSPORT: 'PASSPORT_VERIFIED',
  VOICE_IDENTITY: 'VOICE_VERIFIED',
};

/**
 * Verification foundation. Voice/passport media must never be persisted —
 * only status, verifiedAt, evidenceHash (and optional providerRef).
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trust: TrustService,
  ) {}

  list(userId: bigint) {
    return this.prisma.sellerVerification.findMany({
      where: { userId },
      orderBy: { kind: 'asc' },
    });
  }

  async start(user: AuthUser, kind: SellerVerificationKind) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.sellerVerification.upsert({
        where: { userId_kind: { userId: user.id, kind } },
        create: {
          id: createId(),
          userId: user.id,
          kind,
          status: 'PENDING',
        },
        update: {
          status: 'PENDING',
          rejectedAt: null,
          evidenceHash: null,
          providerRef: null,
        },
      });
      return row;
    }, SERIALIZABLE);
  }

  /**
   * Complete verification. Pass evidencePayload only to hash — never store raw audio/docs.
   * Callers must delete temporary media after this returns.
   */
  async confirm(
    actor: AuthUser,
    userId: bigint,
    kind: SellerVerificationKind,
    opts: { evidencePayload?: string; providerRef?: string; approve?: boolean } = {},
  ) {
    const approve = opts.approve !== false;
    if (!approve && !actor.isAdmin && !actor.isSupport) {
      throw new ForbiddenException('Отклонить верификацию может только поддержка.');
    }
    // Self-confirm allowed for phone stages in foundation; passport/voice_identity need staff.
    if (approve && (kind === 'PASSPORT' || kind === 'VOICE_IDENTITY') && !actor.isAdmin && !actor.isSupport) {
      throw new ForbiddenException('Паспорт и голосовая идентичность подтверждаются поддержкой.');
    }
    if (approve && actor.id !== userId && !actor.isAdmin && !actor.isSupport) {
      throw new ForbiddenException('Нельзя подтвердить чужую верификацию.');
    }

    const evidenceHash = opts.evidencePayload
      ? createHash('sha256').update(opts.evidencePayload).digest('hex')
      : undefined;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.sellerVerification.findUnique({
        where: { userId_kind: { userId, kind } },
      });
      if (!existing) throw new NotFoundException('Верификация не начата.');
      if (existing.status === 'VERIFIED' && approve) return existing;

      const status: SellerVerificationStatus = approve ? 'VERIFIED' : 'REJECTED';
      const updated = await tx.sellerVerification.update({
        where: { id: existing.id },
        data: {
          status,
          evidenceHash: evidenceHash ?? existing.evidenceHash,
          providerRef: opts.providerRef ?? existing.providerRef,
          reviewedById: actor.isAdmin || actor.isSupport ? actor.id : existing.reviewedById,
          verifiedAt: approve ? new Date() : null,
          rejectedAt: approve ? null : new Date(),
          // Explicitly never store media blobs in metadata.
          metadata: { storagePolicy: 'hash_only_no_media' },
        },
      });

      if (approve) {
        const historyType = HISTORY_BY_KIND[kind];
        if (historyType) {
          await this.trust.appendHistory(tx, userId, historyType, { kind });
        }
      } else {
        await this.trust.appendHistory(tx, userId, 'VERIFICATION_REVOKED', { kind, status: 'REJECTED' });
      }
      await this.trust.markDirty(tx, userId);
      return updated;
    }, SERIALIZABLE);
  }

  publicFlags(rows: Array<{ kind: SellerVerificationKind; status: SellerVerificationStatus }>) {
    const verified = new Set(rows.filter((r) => r.status === 'VERIFIED').map((r) => r.kind));
    return {
      phone: verified.has('PHONE_SMS') || verified.has('PHONE_CALL') || verified.has('PHONE_VOICE'),
      phoneStages: {
        sms: verified.has('PHONE_SMS'),
        call: verified.has('PHONE_CALL'),
        voice: verified.has('PHONE_VOICE'),
      },
      passport: verified.has('PASSPORT'),
      voiceIdentity: verified.has('VOICE_IDENTITY'),
    };
  }
}
