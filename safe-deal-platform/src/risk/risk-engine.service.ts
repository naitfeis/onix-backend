import { createHash } from 'crypto';
import { Injectable, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import { MfaStepUpService } from '../mfa/mfa-step-up.service';
import { PrismaService } from '../prisma.service';
import {
  applyStepUpPolicy,
  decideAction,
  decisionReason,
  largeWithdrawCents,
  scoreFactors,
} from './risk-engine.scoring';
import type {
  LoginRiskInput,
  RiskDecision,
  RiskEventDraft,
  RiskFactor,
  WithdrawRiskInput,
} from './risk-engine.types';

type Db = Prisma.TransactionClient | PrismaService;

const HIGH_SESSION_RISK = 40;
const HISTORY_LIMIT = 30;

/**
 * Risk Engine — withdraw + new device/IP (Slice 2) + Telegram MFA step-up (Slice 3).
 */
@Injectable()
export class RiskEngineService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly mfa?: MfaStepUpService,
  ) {}

  /**
   * Score a new session before persist. Emits event drafts for the caller to write
   * inside the same transaction (with sessionId).
   */
  async evaluateLogin(
    input: LoginRiskInput,
    db: Db = this.prisma,
  ): Promise<RiskDecision & { events: RiskEventDraft[]; riskScore: number }> {
    const history = await db.session.findMany({
      where: { userId: input.userId },
      orderBy: { lastSeenAt: 'desc' },
      take: HISTORY_LIMIT,
      select: {
        fingerprintHash: true,
        ipAddress: true,
        country: true,
        timezone: true,
        language: true,
      },
    });

    const factors: RiskFactor[] = [];
    const priorDevices = new Set(
      history.map((s) => s.fingerprintHash).filter((x): x is string => Boolean(x)),
    );
    const priorIps = new Set(
      history.map((s) => s.ipAddress).filter((x): x is string => Boolean(x)),
    );
    const priorCountries = new Set(
      history.map((s) => s.country).filter((x): x is string => Boolean(x)),
    );

    const isFirstSession = history.length === 0;

    if (!isFirstSession && input.deviceId && !priorDevices.has(input.deviceId) && !input.trustedDevice) {
      factors.push('NEW_DEVICE');
    }
    if (!isFirstSession && input.ipAddress && !priorIps.has(input.ipAddress)) {
      factors.push('NEW_IP');
    }
    if (
      !isFirstSession
      && input.country
      && priorCountries.size > 0
      && !priorCountries.has(input.country)
    ) {
      factors.push('NEW_COUNTRY');
    }

    const last = history[0];
    if (last && contextShifted(last.timezone, last.language, input.timezone, input.locale)) {
      factors.push('CONTEXT_SHIFT');
    }

    const score = scoreFactors(factors);
    let action = applyStepUpPolicy(decideAction(score, factors));
    // Login: never BLOCK / never enforce STEP_UP yet (Slice 3). MONITOR + raise session risk.
    if (action === 'STEP_UP' || action === 'BLOCK') action = 'MONITOR';

    const base = input.trustedDevice ? 5 : 20;
    const riskScore = Math.min(100, base + score);

    const events: RiskEventDraft[] = [];
    if (action === 'MONITOR' && factors.length > 0) {
      const type = factors.includes('NEW_COUNTRY') && factors.includes('NEW_IP')
        ? 'IMPOSSIBLE_TRAVEL'
        : 'SESSION_ANOMALY';
      events.push({
        type,
        severity: Math.min(100, 30 + score),
        ipAddress: input.ipAddress ?? null,
        country: input.country ?? null,
        payload: {
          kind: 'LOGIN',
          factors,
          score,
          deviceIdPresent: Boolean(input.deviceId),
          trustedDevice: input.trustedDevice,
          // Context for Risk — not identity
          timezone: input.timezone ?? null,
          locale: input.locale ?? null,
        },
      });
    }

    return {
      action,
      score,
      factors,
      reason: decisionReason(action, factors),
      events,
      riskScore,
    };
  }

  async evaluateWithdraw(
    input: WithdrawRiskInput,
    db: Db = this.prisma,
  ): Promise<RiskDecision & { events: RiskEventDraft[] }> {
    const factors: RiskFactor[] = [];

    const session = input.sessionId
      ? await db.session.findFirst({
        where: { id: input.sessionId, userId: input.userId, revokedAt: null },
        select: {
          id: true,
          fingerprintHash: true,
          ipAddress: true,
          country: true,
          timezone: true,
          language: true,
          riskScore: true,
        },
      })
      : await db.session.findFirst({
        where: { userId: input.userId, revokedAt: null },
        orderBy: { lastSeenAt: 'desc' },
        select: {
          id: true,
          fingerprintHash: true,
          ipAddress: true,
          country: true,
          timezone: true,
          language: true,
          riskScore: true,
        },
      });

    const history = await db.session.findMany({
      where: {
        userId: input.userId,
        ...(session ? { id: { not: session.id } } : {}),
      },
      orderBy: { lastSeenAt: 'desc' },
      take: HISTORY_LIMIT,
      select: {
        fingerprintHash: true,
        ipAddress: true,
        country: true,
      },
    });

    const trusted = session?.fingerprintHash
      ? await db.trustedDevice.findFirst({
        where: {
          userId: input.userId,
          fingerprintHash: session.fingerprintHash,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true },
      })
      : null;

    const priorDevices = new Set(
      history.map((s) => s.fingerprintHash).filter((x): x is string => Boolean(x)),
    );
    const priorIps = new Set(
      history.map((s) => s.ipAddress).filter((x): x is string => Boolean(x)),
    );
    const priorCountries = new Set(
      history.map((s) => s.country).filter((x): x is string => Boolean(x)),
    );

    const deviceId = session?.fingerprintHash ?? null;
    const ip = input.ipAddress ?? session?.ipAddress ?? null;
    const country = input.country ?? session?.country ?? null;

    if (deviceId && !trusted && !priorDevices.has(deviceId)) {
      factors.push('NEW_DEVICE');
    }
    if (ip && priorIps.size > 0 && !priorIps.has(ip)) {
      factors.push('NEW_IP');
    }
    if (country && priorCountries.size > 0 && !priorCountries.has(country)) {
      factors.push('NEW_COUNTRY');
    }

    if (input.amountCents >= largeWithdrawCents()) {
      factors.push('LARGE_AMOUNT');
    }

    if (session && session.riskScore >= HIGH_SESSION_RISK) {
      factors.push('HIGH_SESSION_RISK');
    }

    if (input.payoutDestination?.trim()) {
      const destHash = hashOpaque(input.payoutDestination.trim().toLowerCase());
      const prior = await db.auditLog.findMany({
        where: {
          actorId: input.userId,
          action: 'WALLET_WITHDRAWAL_REQUEST',
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { metadata: true },
      });
      const seen = prior.some((row) => {
        const meta = row.metadata as { destination?: unknown; destinationHash?: unknown } | null;
        if (!meta || typeof meta !== 'object') return false;
        if (typeof meta.destinationHash === 'string') return meta.destinationHash === destHash;
        if (typeof meta.destination === 'string') {
          return hashOpaque(meta.destination.trim().toLowerCase()) === destHash;
        }
        return false;
      });
      if (!seen && prior.length > 0) {
        factors.push('NEW_PAYOUT_DEST');
      }
    }

    const score = scoreFactors(factors);
    let action = applyStepUpPolicy(decideAction(score, factors));

    const events: RiskEventDraft[] = [];
    if (action === 'MONITOR' || action === 'STEP_UP') {
      events.push({
        type: action === 'STEP_UP' ? 'ACCOUNT_TAKEOVER_SUSPECTED' : 'SESSION_ANOMALY',
        severity: Math.min(100, action === 'STEP_UP' ? 70 + Math.floor(score / 5) : 30 + score),
        ipAddress: ip,
        country,
        payload: {
          kind: 'WITHDRAW',
          action,
          factors,
          score,
          amountCents: input.amountCents.toString(),
          sessionId: session?.id ?? null,
          largeThresholdCents: largeWithdrawCents().toString(),
        },
      });
    }

    return {
      action,
      score,
      factors,
      reason: decisionReason(action, factors),
      events,
    };
  }

  /** Persist event drafts (no tokens / secrets). */
  async writeEvents(
    db: Db,
    userId: bigint,
    sessionId: string | null | undefined,
    events: RiskEventDraft[],
  ): Promise<void> {
    for (const event of events) {
      await db.securityEvent.create({
        data: {
          type: event.type,
          status: 'OPEN',
          userId,
          sessionId: sessionId ?? null,
          severity: event.severity,
          ipAddress: event.ipAddress ?? null,
          country: event.country ?? null,
          payload: event.payload as Prisma.InputJsonValue,
        },
      });
    }
  }

  /**
   * Gate withdraw: MONITOR allows + records; STEP_UP issues Telegram MFA (Slice 3)
   * or accepts a CONFIRMED stepUpChallengeId.
   */
  async assertWithdrawAllowed(input: WithdrawRiskInput, db: Db = this.prisma): Promise<RiskDecision> {
    const result = await this.evaluateWithdraw(input, db);
    if (result.events.length > 0) {
      await this.writeEvents(db, input.userId, input.sessionId, result.events);
    }
    if (result.action === 'STEP_UP') {
      if (input.stepUpChallengeId?.trim() && this.mfa) {
        await this.mfa.consumeConfirmed({
          challengeId: input.stepUpChallengeId.trim(),
          userId: input.userId,
          sessionId: input.sessionId,
          purpose: 'WITHDRAW',
          db,
        });
        return {
          action: 'ALLOW',
          score: result.score,
          factors: result.factors,
          reason: 'step_up_passed',
        };
      }
      if (this.mfa && !input.stepUpChallengeId?.trim()) {
        const issued = await this.mfa.issueWithdrawChallenge({
          userId: input.userId,
          sessionId: input.sessionId,
          amountCents: input.amountCents,
          score: result.score,
          factors: result.factors,
        });
        throw new AuthPlatformError(
          'AUTH_STEP_UP_REQUIRED',
          'Подтвердите вывод в Telegram, затем повторите запрос.',
          {
            factors: result.factors,
            score: result.score,
            reason: result.reason,
            challengeId: issued.challengeId,
            expiresAt: issued.expiresAt,
            deepLink: issued.deepLink,
            webDeepLink: issued.webDeepLink,
            delivery: issued.delivery,
          },
        );
      }
      throw new AuthPlatformError(
        'AUTH_STEP_UP_REQUIRED',
        'Для этого вывода требуется дополнительное подтверждение.',
        {
          factors: result.factors,
          score: result.score,
          reason: result.reason,
        },
      );
    }
    if (result.action === 'BLOCK') {
      throw new AuthPlatformError(
        'AUTH_ACCOUNT_LOCKED',
        'Операция заблокирована системой риска.',
        { factors: result.factors, score: result.score },
      );
    }
    return {
      action: result.action,
      score: result.score,
      factors: result.factors,
      reason: result.reason,
    };
  }
}

function contextShifted(
  prevTz: string | null | undefined,
  prevLocale: string | null | undefined,
  nextTz: string | null | undefined,
  nextLocale: string | null | undefined,
): boolean {
  const a = (prevTz ?? '').trim().toLowerCase();
  const b = (nextTz ?? '').trim().toLowerCase();
  const c = (prevLocale ?? '').trim().toLowerCase();
  const d = (nextLocale ?? '').trim().toLowerCase();
  if (a && b && a !== b) return true;
  if (c && d && c !== d) return true;
  return false;
}

function hashOpaque(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 64);
}
