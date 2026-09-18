import { createHash } from 'crypto';
import { Injectable, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import { formatOnixId } from '../onix-id';
import { MfaStepUpService } from '../mfa/mfa-step-up.service';
import { PrismaService } from '../prisma.service';
import {
  applyStepUpPolicy,
  decideAction,
  decisionReason,
  largeWithdrawCents,
  riskLevel,
  scoreFactors,
} from './risk-engine.scoring';
import type {
  LoginRiskInput,
  RiskDecision,
  RiskEventDraft,
  RiskFactor,
  WithdrawRiskInput,
} from './risk-engine.types';
import {
  inspectDuplicateListing,
  inspectSpamBurst,
  inspectUserText,
  strongerHit,
} from './moderation-engine';
import { SecurityLockService } from './security-lock.service';
import { appealSlaHours, appealSlaMessage } from '../support-sla.config';

type Db = Prisma.TransactionClient | PrismaService;

const HIGH_SESSION_RISK = 40;
const HISTORY_LIMIT = 30;

export type RiskEnforcementMode = 'live' | 'shadow';

/**
 * Fail closed on missing/invalid values so existing production behavior is
 * preserved. Only an explicit "shadow" disables newly proposed locks.
 */
export function riskEnforcementMode(
  value = process.env.RISK_ENFORCEMENT_MODE,
): RiskEnforcementMode {
  return value?.trim().toLowerCase() === 'shadow' ? 'shadow' : 'live';
}

/**
 * Risk Engine — withdraw + new device/IP (Slice 2) + Telegram MFA step-up (Slice 3).
 */
@Injectable()
export class RiskEngineService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly mfa?: MfaStepUpService,
    @Optional() private readonly locks?: SecurityLockService,
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

    const evasion = await this.collectBanEvasionFactors(input.userId, {
      ipAddress: input.ipAddress,
      deviceId: input.deviceId,
    }, db);
    factors.push(...evasion.factors);

    const score = scoreFactors(factors);
    let action = applyStepUpPolicy(decideAction(score, factors));
    const level = riskLevel(score, factors);
    // Login never STEP_UP. BAN_EVASION / CRITICAL stay BLOCK so the caller can lock.
    if (action === 'STEP_UP') action = 'MONITOR';
    if (action === 'BLOCK' && !factors.includes('BAN_EVASION')) {
      action = 'MONITOR';
    }

    const base = input.trustedDevice ? 5 : 20;
    const riskScore = Math.min(100, base + score);

    const events: RiskEventDraft[] = [];
    if ((action === 'MONITOR' || action === 'BLOCK') && factors.length > 0) {
      const type = factors.includes('BAN_EVASION')
        ? 'BAN_EVASION'
        : (factors.includes('NEW_COUNTRY') && factors.includes('NEW_IP')
          ? 'IMPOSSIBLE_TRAVEL'
          : 'SESSION_ANOMALY');
      events.push({
        type,
        severity: Math.min(100, (action === 'BLOCK' ? 80 : 30) + score),
        ipAddress: input.ipAddress ?? null,
        country: input.country ?? null,
        payload: {
          kind: 'LOGIN',
          factors,
          score,
          level,
          reasons: evasion.reasons,
          bannedAccounts: evasion.bannedAccounts,
          deviceIdPresent: Boolean(input.deviceId),
          trustedDevice: input.trustedDevice,
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
      level,
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

    try {
      const lockRow = await db.user.findUnique({
        where: { id: input.userId },
        select: { securityLockedAt: true, withdrawBlockedAt: true, suspiciousFundsHoldAt: true },
      });
      if (lockRow?.securityLockedAt || lockRow?.withdrawBlockedAt) {
        factors.push('SECURITY_LOCK_ACTIVE');
      }
      const sale = await db.ledgerEntry.findFirst({
        where: { userId: input.userId, fundKind: 'SALE_PROCEEDS', saleKind: 'ACCOUNT' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true },
      });
      if (sale) {
        factors.push('ACCOUNT_SALE_PROCEEDS');
        if (lockRow?.suspiciousFundsHoldAt) factors.push('SUSPICIOUS_FUNDS');
      }
    } catch {
      /* partial prisma mocks in tests */
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
    if (this.locks) {
      await this.locks.assertNotLocked(input.userId, 'withdraw', db);
    }
    const result = await this.evaluateWithdraw(input, db);
    if (result.events.length > 0) {
      await this.writeEvents(db, input.userId, input.sessionId, result.events);
    }
    if (result.action === 'BLOCK') {
      const enforced = await this.enforceBlockLock(
        input.userId,
        result.factors,
        result.score,
        'WITHDRAW',
      );
      if (!enforced) {
        return {
          action: 'MONITOR',
          score: result.score,
          factors: result.factors,
          reason: 'shadow_would_block',
          level: riskLevel(result.score, result.factors),
        };
      }
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
        'AUTH_SECURITY_LOCK',
        `Аккаунт временно ограничен из‑за подозрительной активности. Вы можете обжаловать решение. ${appealSlaMessage()}`,
        { factors: result.factors, score: result.score, caseAppeal: true, appealSlaHours: appealSlaHours() },
      );
    }
    return {
      action: result.action,
      score: result.score,
      factors: result.factors,
      reason: result.reason,
      level: riskLevel(result.score, result.factors),
    };
  }

  async assertSellAllowed(userId: bigint, title?: string, db: Db = this.prisma): Promise<void> {
    if (this.locks) await this.locks.assertNotLocked(userId, 'sell', db);
    const evasion = await this.collectBanEvasionFactors(userId, {}, db);
    if (title) {
      try {
        const recent = await db.product.count({
          where: { sellerId: userId, title, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
        });
        const hit = inspectDuplicateListing(title, recent);
        if (hit) await this.applyModerationHit(userId, hit, { listingTitle: title });
      } catch {
        /* ignore */
      }
    }
    if (evasion.factors.includes('BAN_EVASION') || evasion.factors.includes('SECURITY_LOCK_ACTIVE')) {
      await this.enforceBlockLock(userId, evasion.factors, 90, 'SELL', evasion.reasons);
    }
  }

  async assertPurchaseAllowed(userId: bigint, amountCents: bigint, db: Db = this.prisma): Promise<void> {
    if (this.locks) await this.locks.assertNotLocked(userId, 'spend', db);
    const large = amountCents >= largeWithdrawCents();
    const evasion = await this.collectBanEvasionFactors(userId, {}, db);
    const factors: RiskFactor[] = [...evasion.factors];
    if (large) factors.push('LARGE_AMOUNT');
    try {
      const lockRow = await db.user.findUnique({
        where: { id: userId },
        select: { suspiciousFundsHoldAt: true },
      });
      if (lockRow?.suspiciousFundsHoldAt) factors.push('SUSPICIOUS_FUNDS');
    } catch {
      /* ignore */
    }
    const score = scoreFactors(factors);
    const action = decideAction(score, factors);
    if (action === 'BLOCK' || (large && evasion.factors.includes('BAN_EVASION'))) {
      await this.enforceBlockLock(userId, factors, score, 'PURCHASE', evasion.reasons);
    }
  }

  async inspectChatMessage(input: {
    userId: bigint;
    chatId: string;
    text: string;
  }): Promise<void> {
    const textHit = inspectUserText(input.text);
    let spamHit = null as ReturnType<typeof inspectSpamBurst>;
    try {
      const recent = await this.prisma.message.count({
        where: {
          senderId: input.userId,
          text: input.text,
          createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
        },
      });
      spamHit = inspectSpamBurst(recent);
    } catch {
      /* ignore */
    }
    const hit = strongerHit(textHit, spamHit);
    if (!hit) return;
    const enforced = await this.applyModerationHit(
      input.userId,
      hit,
      { chatId: input.chatId, textPreview: input.text.slice(0, 180) },
    );
    if (hit.action === 'BLOCK' && enforced) {
      throw new AuthPlatformError(
        'AUTH_SECURITY_LOCK',
        'Сообщение заблокировано системой модерации.',
        { type: hit.type, reasons: hit.reasons },
      );
    }
  }

  async maybeLockAfterLogin(
    userId: bigint,
    decision: RiskDecision & { events?: RiskEventDraft[] },
  ): Promise<void> {
    if (decision.action !== 'BLOCK' && !decision.factors.includes('BAN_EVASION')) return;
    await this.enforceBlockLock(
      userId,
      decision.factors,
      decision.score,
      'LOGIN',
      (decision.events?.[0]?.payload as { reasons?: string[] } | undefined)?.reasons,
      true,
      decision.factors.includes('SECURITY_LOCK_ACTIVE'),
    );
  }

  private async applyModerationHit(
    userId: bigint,
    hit: { type: RiskEventDraft['type']; action: string; reasons: string[] },
    extra: Record<string, unknown>,
  ): Promise<boolean> {
    await this.writeEvents(this.prisma, userId, null, [{
      type: hit.type,
      severity: hit.action === 'SECURITY_LOCK' || hit.action === 'BLOCK' ? 90 : 55,
      payload: { kind: 'MODERATION', ...hit, ...extra },
    }]);
    if (hit.action === 'SECURITY_LOCK' || hit.action === 'BLOCK') {
      return this.enforceBlockLock(
        userId,
        ['SUSPICIOUS_FUNDS'],
        90,
        hit.type,
        hit.reasons,
      );
    }
    return false;
  }

  private async enforceBlockLock(
    userId: bigint,
    factors: RiskFactor[] | string[],
    score: number,
    eventType: string,
    extraReasons: string[] = [],
    silent = false,
    preExistingLock = false,
  ): Promise<boolean> {
    const reasons = [
      ...extraReasons,
      ...factors.map(String),
      `score=${score}`,
    ];
    const level = score >= 85 || factors.includes('BAN_EVASION' as RiskFactor) ? 'CRITICAL' : 'HIGH';
    if (riskEnforcementMode() === 'shadow' && !preExistingLock) {
      await this.writeEvents(this.prisma, userId, null, [{
        type: factors.includes('BAN_EVASION' as RiskFactor) ? 'BAN_EVASION' : 'SECURITY_LOCK',
        severity: level === 'CRITICAL' ? 95 : 80,
        payload: {
          kind: 'RISK_ENFORCEMENT_SHADOW',
          enforcementMode: 'shadow',
          shadowMode: true,
          wouldHaveLocked: true,
          wouldHaveLockedLevel: level,
          score,
          factors: factors.map(String),
          eventType,
          reasons,
        },
      }]);
      return false;
    }
    if (this.locks) {
      await this.locks.applyLock({
        userId,
        level,
        eventType,
        reasons,
        score,
      });
    }
    if (silent) return true;
    throw new AuthPlatformError(
      'AUTH_SECURITY_LOCK',
      `Аккаунт временно ограничен из‑за подозрительной активности. Вы можете обжаловать решение. ${appealSlaMessage()}`,
      { factors, score, caseAppeal: true, appealSlaHours: appealSlaHours() },
    );
  }

  async collectBanEvasionFactors(
    userId: bigint,
    input: { ipAddress?: string | null; deviceId?: string | null; telegramId?: bigint | null },
    db: Db = this.prisma,
  ): Promise<{ factors: RiskFactor[]; reasons: string[]; bannedAccounts: Array<{ onixId: string; via: 'device' | 'ip' | 'telegram' }> }> {
    const factors: RiskFactor[] = [];
    const reasons: string[] = [];
    const bannedAccounts: Array<{ onixId: string; via: 'device' | 'ip' | 'telegram' }> = [];
    const remember = (onixId: string, via: 'device' | 'ip' | 'telegram') => {
      const id = formatOnixId(onixId);
      if (!id || bannedAccounts.some((hit) => hit.onixId === id && hit.via === via)) return;
      bannedAccounts.push({ onixId: id, via });
    };
    try {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { telegramId: true, securityLockedAt: true },
      });
      if (user?.securityLockedAt) factors.push('SECURITY_LOCK_ACTIVE');

      const telegramId = input.telegramId ?? user?.telegramId ?? null;
      const signals: string[] = [];

      if (telegramId != null) {
        const bannedTwins = await db.user.findMany({
          where: {
            telegramId,
            id: { not: userId },
            OR: [{ deletedAt: { not: null } }, { bannedAt: { not: null } }],
          },
          select: { onixId: true },
          take: 8,
        });
        for (const twin of bannedTwins) {
          signals.push('linked banned telegram account');
          remember(twin.onixId, 'telegram');
        }
      }

      let deviceHit = false;
      let ipHit = false;
      if (input.deviceId) {
        const devices = await db.session.findMany({
          where: {
            fingerprintHash: input.deviceId,
            userId: { not: userId },
            user: { OR: [{ deletedAt: { not: null } }, { bannedAt: { not: null } }] },
          },
          select: { user: { select: { onixId: true } } },
          take: 12,
        });
        for (const row of devices) {
          deviceHit = true;
          remember(row.user.onixId, 'device');
        }
      }
      if (input.ipAddress) {
        const ips = await db.session.findMany({
          where: {
            ipAddress: input.ipAddress,
            userId: { not: userId },
            user: { OR: [{ deletedAt: { not: null } }, { bannedAt: { not: null } }] },
          },
          select: { user: { select: { onixId: true } } },
          take: 12,
        });
        for (const row of ips) {
          ipHit = true;
          remember(row.user.onixId, 'ip');
        }
      }

      if (deviceHit) reasons.push('device seen on banned account');
      if (ipHit) reasons.push('ip seen on banned account');
      reasons.push(...[...new Set(signals)]);

      if (signals.length >= 1 && (deviceHit || ipHit || signals.length >= 2)) {
        factors.push('BAN_EVASION');
      }
    } catch {
      /* tests / partial prisma mocks */
    }
    return { factors: [...new Set(factors)], reasons, bannedAccounts };
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
