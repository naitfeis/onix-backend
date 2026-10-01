import { createHash } from 'crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { DeviceTrustService } from './auth-v2/device-trust.service';
import type { AbuseMarkerKind, Prisma } from '@prisma/client';
import { AuthPlatformError } from './auth-v2/auth-errors';
import type { DeviceContext } from './auth-v2/session.service';
/**
 * Value import, NOT `import type`: Nest resolves constructor dependencies from the
 * emitted `design:paramtypes`, and a type-only import erases the reference to
 * `Function`. Combined with @Optional() that silently injects undefined, so the
 * evidence-survives-rollback fix below would be inert in production.
 */
import { PrismaService } from './prisma.service';

const WEIGHT: Record<AbuseMarkerKind, number> = {
  FINGERPRINT: 40,
  BROWSER_ID: 35,
  IP: 15,
  USER_AGENT: 10,
  TELEGRAM_ID: 45,
  PHONE_HASH: 40,
  VK_ID: 40,
};

/** Block when score >= threshold AND at least 2 distinct factors (never IP alone). */
const BLOCK_SCORE = 50;
const MIN_FACTORS = 2;

export type RiskDeviceInput = DeviceContext & {
  browserId?: string | null;
};

type Db = Prisma.TransactionClient | {
  abuseMarker: { findMany: Prisma.TransactionClient['abuseMarker']['findMany']; createMany: Prisma.TransactionClient['abuseMarker']['createMany']; updateMany: Prisma.TransactionClient['abuseMarker']['updateMany'] };
  securityEvent: { create: Prisma.TransactionClient['securityEvent']['create'] };
  session: { findMany: Prisma.TransactionClient['session']['findMany'] };
  user: { findUnique: Prisma.TransactionClient['user']['findUnique'] };
  identityLink: { findMany: Prisma.TransactionClient['identityLink']['findMany'] };
};

function hashValue(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 64);
}

/**
 * Multi-factor registration Risk Score.
 * Does not ban by IP or device alone — requires several matching markers from banned accounts.
 */
@Injectable()
export class RiskScoreService {
  private readonly logger = new Logger(RiskScoreService.name);

  /**
   * DeviceTrustService is optional so unit tests can construct the service directly;
   * when absent the derived deviceId falls back to the client value (still no match,
   * but IP/USER_AGENT/BROWSER_ID signals keep working).
   */
  constructor(
    @Optional() private readonly deviceTrust?: DeviceTrustService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /** Server-derived deviceId — the SAME value stored on Session.fingerprintHash. */
  private resolveDeviceId(device?: RiskDeviceInput | null): string | null {
    if (!device || !this.deviceTrust) return null;
    try {
      return this.deviceTrust.resolveDeviceId(device);
    } catch {
      return null;
    }
  }

  async assertNewRegistrationAllowed(
    db: Db,
    input: { telegramId: bigint; device?: RiskDeviceInput | null },
  ): Promise<{ score: number; factors: AbuseMarkerKind[] }> {
    const derivedDeviceId = this.resolveDeviceId(input.device);
    const signals = this.collectSignals(input.device, derivedDeviceId, input.telegramId);
    if (signals.length === 0) {
      return { score: 0, factors: [] };
    }

    const or = signals.map((s) => ({ kind: s.kind, valueHash: s.valueHash, revokedAt: null }));
    const hits = await db.abuseMarker.findMany({
      where: { OR: or },
      select: { kind: true, valueHash: true, sourceUserId: true },
      take: 20,
    });

    const factors = [...new Set(hits.map((h) => h.kind))];
    const score = factors.reduce((sum, kind) => sum + WEIGHT[kind], 0);

    if (score >= BLOCK_SCORE && factors.length >= MIN_FACTORS) {
      /**
       * Evidence must outlive the rollback. Callers pass their own transaction, and the
       * throw below rolls it back — writing this event on `db` erased the only record
       * support had of a blocked signup attempt. Use the outer connection when present.
       */
      const eventDb = this.prisma ?? db;
      if (!this.prisma) {
        this.logger.warn(
          'REGISTRATION_BLOCKED evidence may roll back: RiskScoreService has no PrismaService',
        );
      }
      await eventDb.securityEvent.create({
        data: {
          type: 'REGISTRATION_BLOCKED',
          status: 'OPEN',
          severity: Math.min(100, score),
          ipAddress: input.device?.ipAddress ?? null,
          payload: {
            telegramId: input.telegramId.toString(),
            score,
            factors,
            hits: hits.map((h) => ({
              kind: h.kind,
              sourceUserId: h.sourceUserId.toString(),
            })),
          },
        },
      });
      throw new AuthPlatformError(
        'AUTH_ACCOUNT_LOCKED',
        'Registration blocked by multi-factor risk score.',
      );
    }

    return { score, factors };
  }

  /** Record markers from banned user's recent sessions (+ optional current device). */
  async recordBanMarkers(
    db: Db,
    sourceUserId: bigint,
    device?: RiskDeviceInput | null,
  ): Promise<void> {
    const sessions = await db.session.findMany({
      where: { userId: sourceUserId },
      orderBy: { lastSeenAt: 'desc' },
      take: 10,
      select: { fingerprintHash: true, ipAddress: true, userAgent: true },
    });

    const rows: Array<{ kind: AbuseMarkerKind; valueHash: string; sourceUserId: bigint }> = [];
    const push = (kind: AbuseMarkerKind, raw?: string | null) => {
      const value = raw?.trim();
      if (!value) return;
      rows.push({ kind, valueHash: hashValue(value), sourceUserId });
    };

    for (const session of sessions) {
      push('FINGERPRINT', session.fingerprintHash);
      push('IP', session.ipAddress);
      push('USER_AGENT', session.userAgent);
    }
    // Same derivation the registration check uses, so the two spaces always agree.
    push('FINGERPRINT', this.resolveDeviceId(device) ?? device?.fingerprintHash);
    push('BROWSER_ID', device?.browserId);
    push('IP', device?.ipAddress);
    push('USER_AGENT', device?.userAgent);

    const [user, links] = await Promise.all([
      db.user.findUnique({
        where: { id: sourceUserId },
        select: { telegramId: true, phoneHash: true },
      }),
      db.identityLink.findMany({
        where: { userId: sourceUserId, deletedAt: null },
        select: { provider: true, providerUserId: true },
      }),
    ]);
    push('TELEGRAM_ID', user?.telegramId?.toString() ?? null);
    // phoneHash is already an HMAC, so it is stored directly (never re-hashed) — it is
    // the strongest registration signal available: a fresh account with the same phone
    // matches 40 points and, with any second marker, blocks signup.
    if (user?.phoneHash) rows.push({ kind: 'PHONE_HASH', valueHash: user.phoneHash, sourceUserId });
    for (const link of links) {
      if (link.provider === 'TELEGRAM') push('TELEGRAM_ID', link.providerUserId);
    }

    const unique = new Map(rows.map((r) => [`${r.kind}:${r.valueHash}`, r]));
    if (unique.size === 0) return;

    await db.abuseMarker.createMany({
      data: [...unique.values()].map((r) => ({
        kind: r.kind,
        valueHash: r.valueHash,
        sourceUserId: r.sourceUserId,
      })),
      skipDuplicates: true,
    });
  }

  /** Admin unban lifts markers contributed by that account. */
  async revokeBanMarkers(db: Db, sourceUserId: bigint): Promise<void> {
    await db.abuseMarker.updateMany({
      where: { sourceUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Signals compared against AbuseMarker at registration.
   *
   * FINGERPRINT must be the SERVER-DERIVED deviceId: recordBanMarkers writes
   * Session.fingerprintHash, which DeviceTrustService produced. Comparing it against
   * the client-sent `fingerprintHash` never matched — clients do not send one
   * (sanitizeDevice strips it) — so the strongest marker was dead and a banned
   * fraudster could only ever match IP + USER_AGENT: 15 + 10 = 25, permanently
   * below BLOCK_SCORE(50). Registration blocking was unreachable by construction.
   */
  private collectSignals(
    device?: RiskDeviceInput | null,
    derivedDeviceId?: string | null,
    telegramId?: bigint | null,
  ): Array<{ kind: AbuseMarkerKind; valueHash: string }> {
    if (!device && telegramId == null) return [];
    const out: Array<{ kind: AbuseMarkerKind; valueHash: string }> = [];
    const add = (kind: AbuseMarkerKind, raw?: string | null) => {
      const value = raw?.trim();
      if (!value) return;
      out.push({ kind, valueHash: hashValue(value) });
    };
    add('FINGERPRINT', derivedDeviceId || device?.fingerprintHash);
    add('BROWSER_ID', device?.browserId);
    add('IP', device?.ipAddress);
    add('USER_AGENT', device?.userAgent);
    add('TELEGRAM_ID', telegramId?.toString() ?? null);
    return out;
  }
}
