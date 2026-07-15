import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { AbuseMarkerKind, Prisma } from '@prisma/client';
import { AuthPlatformError } from './auth-v2/auth-errors';
import type { DeviceContext } from './auth-v2/session.service';

const WEIGHT: Record<AbuseMarkerKind, number> = {
  FINGERPRINT: 40,
  BROWSER_ID: 35,
  IP: 15,
  USER_AGENT: 10,
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
  async assertNewRegistrationAllowed(
    db: Db,
    input: { telegramId: bigint; device?: RiskDeviceInput | null },
  ): Promise<{ score: number; factors: AbuseMarkerKind[] }> {
    const signals = this.collectSignals(input.device);
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
      await db.securityEvent.create({
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
    push('FINGERPRINT', device?.fingerprintHash);
    push('BROWSER_ID', device?.browserId);
    push('IP', device?.ipAddress);
    push('USER_AGENT', device?.userAgent);

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

  private collectSignals(device?: RiskDeviceInput | null): Array<{ kind: AbuseMarkerKind; valueHash: string }> {
    if (!device) return [];
    const out: Array<{ kind: AbuseMarkerKind; valueHash: string }> = [];
    const add = (kind: AbuseMarkerKind, raw?: string | null) => {
      const value = raw?.trim();
      if (!value) return;
      out.push({ kind, valueHash: hashValue(value) });
    };
    add('FINGERPRINT', device.fingerprintHash);
    add('BROWSER_ID', device.browserId);
    add('IP', device.ipAddress);
    add('USER_AGENT', device.userAgent);
    return out;
  }
}
