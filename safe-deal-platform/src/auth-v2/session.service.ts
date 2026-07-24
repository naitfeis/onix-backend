import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma, Session, SessionRevokeReason, User } from '@prisma/client';
import { BAN_CLEAR_DATA, banPublicInfo, isBanActive } from '../ban-policy';
import { PrismaService } from '../prisma.service';
import { AuthPlatformError } from './auth-errors';
import {
  DEFAULT_SESSION_RISK_SCORE,
  MAX_SESSIONS_PER_USER,
  refreshReuseGraceMs,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_REMEMBER_IDLE_TTL_MS,
  TRUSTED_DEVICE_RISK_SCORE,
} from './session.constants';
import { type AccessTokenClaims, TokenService } from './token.service';

export interface DeviceContext {
  deviceName?: string | null;
  browser?: string | null;
  os?: string | null;
  platform?: string | null;
  timezone?: string | null;
  language?: string | null;
  userAgent?: string | null;
  fingerprintHash?: string | null;
  browserId?: string | null;
  screenResolution?: string | null;
  webglHash?: string | null;
  canvasHash?: string | null;
  ipAddress?: string | null;
  asn?: number | null;
  country?: string | null;
  city?: string | null;
}

export interface CreateSessionInput {
  userId: bigint;
  rememberMe?: boolean;
  clientType?: string;
  amr?: string[];
  device?: DeviceContext;
  provider?: 'TELEGRAM' | 'GOOGLE' | 'APPLE' | 'DISCORD' | 'STEAM' | 'VK' | 'EMAIL' | 'PASSKEY';
}

export interface SessionAuthResult {
  session: Session;
  user: Pick<User, 'id' | 'onixId' | 'sessionVersion' | 'permissionVersion' | 'isAdmin' | 'deletedAt'>;
  accessToken: string;
  refreshToken: string;
  trustedDevice: boolean;
}

type RotationGraceEntry = {
  presentedHash: string;
  result: SessionAuthResult;
  cachedAt: number;
};

@Injectable()
export class SessionService {
  /** In-process idempotency for concurrent refresh (same previous token).
   * Scale-out gate: WEB_CONCURRENCY > 1 or multi-instance → shared store required
   * (see ops-gates.ts). Single-node Render: in-memory grace is intentional.
   */
  private readonly rotationGraceCache = new Map<string, RotationGraceEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /** Test helper — simulate grace expiry / multi-instance without shared cache. */
  clearRotationGraceCache(): void {
    this.rotationGraceCache.clear();
  }

  async createSession(input: CreateSessionInput): Promise<SessionAuthResult> {
    const found = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!found) {
      throw new AuthPlatformError('AUTH_ACCOUNT_LOCKED', 'Account is locked or missing.');
    }
    const user = await this.resolveUserAccountLock(found, this.prisma);

    const prepared = await this.prepareSessionMaterial(user, input);
    const session = await this.prisma.$transaction(async (tx) => (
      this.persistPreparedSession(tx, user, input, prepared)
    ));

    return this.toAuthResult(user, session, prepared.refresh.token, input.amr, prepared.trusted);
  }

  /**
   * Persist session rows inside an outer transaction (ADR-031 login TX).
   * Caller must issue no domain events until after COMMIT.
   */
  async createSessionInTransaction(
    tx: Prisma.TransactionClient,
    user: User,
    input: CreateSessionInput,
  ): Promise<{ session: Session; refreshToken: string; trustedDevice: boolean }> {
    user = await this.resolveUserAccountLock(user, tx);
    const prepared = await this.prepareSessionMaterial(user, input, tx);
    const session = await this.persistPreparedSession(tx, user, input, prepared);
    return {
      session,
      refreshToken: prepared.refresh.token,
      trustedDevice: Boolean(prepared.trusted),
    };
  }

  issueTokensForSession(
    user: Pick<User, 'id' | 'sessionVersion' | 'permissionVersion'>,
    sessionId: string,
    refreshToken: string,
    amr?: string[],
    trustedDevice = false,
  ): Omit<SessionAuthResult, 'session' | 'user'> & { accessToken: string; refreshToken: string; trustedDevice: boolean } {
    return {
      accessToken: this.tokens.issueAccessToken({
        userId: user.id,
        sessionId,
        sessionVersion: user.sessionVersion,
        permissionVersion: user.permissionVersion,
        amr,
      }),
      refreshToken,
      trustedDevice,
    };
  }

  private async prepareSessionMaterial(
    user: User,
    input: CreateSessionInput,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{
    refresh: { token: string; hash: string };
    trusted: { id: string } | null;
    riskScore: number;
    rememberMe: boolean;
    idleMs: number;
    now: Date;
    device: DeviceContext;
    fingerprintHash: string | null;
    familyId: string;
    sessionId: string;
  }> {
    const rememberMe = input.rememberMe === true;
    const now = new Date();
    const idleMs = rememberMe ? SESSION_REMEMBER_IDLE_TTL_MS : SESSION_IDLE_TTL_MS;
    const device = input.device ?? {};
    const fingerprintHash = device.fingerprintHash ?? null;

    const trusted = fingerprintHash
      ? await db.trustedDevice.findFirst({
        where: {
          userId: user.id,
          fingerprintHash,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      })
      : null;

    return {
      refresh: this.tokens.issueRefreshToken(),
      trusted,
      riskScore: trusted ? TRUSTED_DEVICE_RISK_SCORE : DEFAULT_SESSION_RISK_SCORE,
      rememberMe,
      idleMs,
      now,
      device,
      fingerprintHash,
      familyId: newId(),
      sessionId: newId(),
    };
  }

  private async persistPreparedSession(
    tx: Prisma.TransactionClient,
    user: User,
    input: CreateSessionInput,
    prepared: Awaited<ReturnType<SessionService['prepareSessionMaterial']>>,
  ): Promise<Session> {
    const {
      refresh, trusted, riskScore, rememberMe, idleMs, now, device, fingerprintHash, familyId, sessionId,
    } = prepared;

    await this.enforceSessionLimit(tx, user.id, now);

    const session = await tx.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        familyId,
        clientType: input.clientType ?? 'WEB',
        refreshGeneration: 0,
        refreshTokenHash: refresh.hash,
        previousRefreshHash: null,
        lockVersion: 0,
        riskScore,
        riskUpdatedAt: now,
        rememberMe,
        deviceName: device.deviceName ?? null,
        browser: device.browser ?? null,
        os: device.os ?? null,
        platform: device.platform ?? null,
        timezone: device.timezone ?? null,
        language: device.language ?? null,
        userAgent: device.userAgent ?? null,
        fingerprintHash,
        screenResolution: device.screenResolution ?? null,
        webglHash: device.webglHash ?? null,
        canvasHash: device.canvasHash ?? null,
        ipAddress: device.ipAddress ?? null,
        asn: device.asn ?? null,
        country: device.country ?? null,
        city: device.city ?? null,
        createdAt: now,
        lastSeenAt: now,
        refreshExpiresAt: new Date(now.getTime() + idleMs),
        absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
        revokedAt: null,
        revokeReason: null,
      },
    });

    if (trusted) {
      await tx.trustedDevice.update({
        where: { id: trusted.id },
        data: { lastSeenAt: now },
      });
    }

    await tx.authAuditLog.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        action: 'LOGIN_SUCCESS',
        provider: input.provider ?? null,
        ipAddress: device.ipAddress ?? null,
        country: device.country ?? null,
        userAgent: device.userAgent ?? null,
        fingerprint: fingerprintHash,
        metadata: {
          rememberMe,
          trustedDevice: Boolean(trusted),
          familyId,
        },
      },
    });

    return session;
  }

  private toAuthResult(
    user: User,
    session: Session,
    refreshToken: string,
    amr: string[] | undefined,
    trusted: { id: string } | null | boolean,
  ): SessionAuthResult {
    const trustedDevice = typeof trusted === 'boolean' ? trusted : Boolean(trusted);
    return {
      session,
      user: {
        id: user.id,
        onixId: user.onixId,
        sessionVersion: user.sessionVersion,
        permissionVersion: user.permissionVersion,
        isAdmin: user.isAdmin,
        deletedAt: user.deletedAt,
      },
      accessToken: this.tokens.issueAccessToken({
        userId: user.id,
        sessionId: session.id,
        sessionVersion: user.sessionVersion,
        permissionVersion: user.permissionVersion,
        amr,
      }),
      refreshToken,
      trustedDevice,
    };
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { id: sessionId } });
  }

  async listSessions(userId: bigint): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  /**
   * Lightweight cookie session probe for GET /api/v2/auth/session.
   * Single DB round-trip (session + user select). No Telegram, refresh rotation,
   * permissions, profile, or ban-clear writes.
   */
  async getSessionByRefreshToken(
    refreshToken: string,
    timing?: {
      hashMs?: number;
      sessionLookupMs?: number;
      userLookupMs?: number;
    },
  ): Promise<{
    user: Pick<User, 'id' | 'onixId' | 'isAdmin' | 'sessionVersion' | 'permissionVersion'>;
    session: Pick<
      Session,
      | 'id'
      | 'rememberMe'
      | 'lastSeenAt'
      | 'createdAt'
      | 'absoluteExpiresAt'
      | 'refreshExpiresAt'
    >;
  }> {
    if (!refreshToken) {
      throw new AuthPlatformError('AUTH_REFRESH_MISSING', 'Refresh token is missing.');
    }

    const tHash = performance.now();
    const presentedHash = this.tokens.hashRefreshToken(refreshToken);
    if (timing) timing.hashMs = performance.now() - tHash;

    const now = new Date();
    const tDb = performance.now();
    const row = await this.prisma.session.findUnique({
      where: { refreshTokenHash: presentedHash },
      select: {
        id: true,
        rememberMe: true,
        lastSeenAt: true,
        createdAt: true,
        absoluteExpiresAt: true,
        refreshExpiresAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            onixId: true,
            isAdmin: true,
            sessionVersion: true,
            permissionVersion: true,
            deletedAt: true,
            banReason: true,
            banComment: true,
            bannedAt: true,
            bannedUntil: true,
          },
        },
      },
    });
    if (timing) timing.sessionLookupMs = performance.now() - tDb;

    if (!row) {
      throw new AuthPlatformError('AUTH_REFRESH_MISSING', 'Refresh token is unknown.');
    }

    this.assertSessionUsable(
      {
        revokedAt: row.revokedAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        refreshExpiresAt: row.refreshExpiresAt,
        lastSeenAt: row.lastSeenAt,
        rememberMe: row.rememberMe,
      } as Session,
      now,
    );

    const tUser = performance.now();
    const user = row.user;
    if (!user) {
      throw new AuthPlatformError('AUTH_ACCOUNT_LOCKED', 'Account is locked or missing.');
    }
    // Read-only lock check — never write BAN_CLEAR on the probe path.
    if (user.deletedAt && isBanActive(user)) {
      throw new AuthPlatformError('AUTH_ACCOUNT_LOCKED', 'Account is locked or missing.', {
        ban: banPublicInfo(user),
      });
    }
    if (timing) timing.userLookupMs = performance.now() - tUser;

    return {
      user: {
        id: user.id,
        onixId: user.onixId,
        isAdmin: user.isAdmin,
        sessionVersion: user.sessionVersion,
        permissionVersion: user.permissionVersion,
      },
      session: {
        id: row.id,
        rememberMe: row.rememberMe,
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        refreshExpiresAt: row.refreshExpiresAt,
      },
    };
  }

  async rotateRefresh(
    refreshToken: string,
    device?: DeviceContext,
    timing?: { dbMs: number; tokenMs: number },
  ): Promise<SessionAuthResult> {
    if (!refreshToken) {
      throw new AuthPlatformError('AUTH_REFRESH_MISSING', 'Refresh token is missing.');
    }

    const presentedHash = this.tokens.hashRefreshToken(refreshToken);
    const now = new Date();

    const tDb0 = process.hrtime.bigint();
    const current = await this.prisma.session.findUnique({
      where: { refreshTokenHash: presentedHash },
    });
    if (timing) timing.dbMs += Number(process.hrtime.bigint() - tDb0) / 1e6;

    if (current) {
      return this.rotateCurrentSession(current, presentedHash, now, device, timing);
    }

    const tDb1 = process.hrtime.bigint();
    const reused = await this.prisma.session.findFirst({
      where: { previousRefreshHash: presentedHash },
    });
    if (timing) timing.dbMs += Number(process.hrtime.bigint() - tDb1) / 1e6;
    if (reused) {
      // Multi-tab / parallel refresh: both sent the same cookie before Set-Cookie landed.
      const grace = await this.waitForGraceRotation(reused.id, presentedHash);
      if (grace) return grace;

      await this.handleRefreshReuse(reused, presentedHash, device);
      throw new AuthPlatformError('AUTH_REFRESH_REUSED', 'Refresh token reuse detected.');
    }

    throw new AuthPlatformError('AUTH_REFRESH_MISSING', 'Refresh token is unknown.');
  }

  async revokeSession(
    sessionId: string,
    reason: SessionRevokeReason = 'LOGOUT',
    actorUserId?: bigint,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({ where: { id: sessionId } });
      if (!session || session.revokedAt) return;

      if (actorUserId !== undefined && session.userId !== actorUserId) {
        throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Session does not belong to user.');
      }

      await tx.session.update({
        where: { id: sessionId },
        data: { revokedAt: now, revokeReason: reason },
      });

      await tx.authAuditLog.create({
        data: {
          userId: session.userId,
          sessionId: session.id,
          action: reason === 'LOGOUT' ? 'LOGOUT' : 'SESSION_REVOKED',
          ipAddress: session.ipAddress,
          country: session.country,
          userAgent: session.userAgent,
          fingerprint: session.fingerprintHash,
          metadata: { reason, familyId: session.familyId },
        },
      });
    });
  }

  async revokeAllSessions(
    userId: bigint,
    reason: SessionRevokeReason = 'LOGOUT_ALL',
  ): Promise<{ revoked: number; sessionVersion: number }> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: reason },
      });

      const user = await tx.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      });

      await tx.authAuditLog.create({
        data: {
          userId,
          action: 'SESSION_VERSION_BUMP',
          metadata: { reason, revoked: updated.count, sessionVersion: user.sessionVersion },
        },
      });

      await tx.authAuditLog.create({
        data: {
          userId,
          action: 'SESSION_REVOKED',
          metadata: { reason, scope: 'all', revoked: updated.count },
        },
      });

      return { revoked: updated.count, sessionVersion: user.sessionVersion };
    });
  }

  /**
   * Validates access JWT claims against live Session + User.sessionVersion (ADR-005).
   */
  async validateAccessClaims(claims: AccessTokenClaims): Promise<{
    user: User;
    session: Session;
  }> {
    const userId = BigInt(claims.sub);
    const [found, session] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.session.findUnique({ where: { id: claims.sid } }),
    ]);

    if (!found) {
      throw new AuthPlatformError('AUTH_ACCOUNT_LOCKED', 'Account is locked or missing.');
    }
    const user = await this.resolveUserAccountLock(found, this.prisma);
    if (claims.sv !== user.sessionVersion) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token sessionVersion is stale.');
    }
    if (!session || session.userId !== userId) {
      throw new AuthPlatformError('AUTH_SESSION_EXPIRED', 'Session was not found.');
    }

    this.assertSessionUsable(session, new Date());
    return { user, session };
  }

  async isTrustedDevice(userId: bigint, fingerprintHash: string | null | undefined): Promise<boolean> {
    if (!fingerprintHash) return false;
    const now = new Date();
    const row = await this.prisma.trustedDevice.findFirst({
      where: {
        userId,
        fingerprintHash,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    return Boolean(row);
  }

  private async rotateCurrentSession(
    session: Session,
    presentedHash: string,
    now: Date,
    device?: DeviceContext,
    timing?: { dbMs: number; tokenMs: number },
  ): Promise<SessionAuthResult> {
    this.assertSessionUsable(session, now);

    const tDb0 = process.hrtime.bigint();
    const found = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!found) {
      throw new AuthPlatformError('AUTH_ACCOUNT_LOCKED', 'Account is locked or missing.');
    }
    const user = await this.resolveUserAccountLock(found, this.prisma);
    if (timing) timing.dbMs += Number(process.hrtime.bigint() - tDb0) / 1e6;

    const idleMs = session.rememberMe ? SESSION_REMEMBER_IDLE_TTL_MS : SESSION_IDLE_TTL_MS;
    const tTok0 = process.hrtime.bigint();
    const nextRefresh = this.tokens.issueRefreshToken();
    if (timing) timing.tokenMs += Number(process.hrtime.bigint() - tTok0) / 1e6;

    const tDb1 = process.hrtime.bigint();
    let rotated: Session;
    try {
      rotated = await this.prisma.$transaction(async (tx) => {
        const cas = await tx.session.updateMany({
          where: {
            id: session.id,
            refreshTokenHash: presentedHash,
            revokedAt: null,
          },
          data: {
            previousRefreshHash: presentedHash,
            refreshTokenHash: nextRefresh.hash,
            refreshGeneration: { increment: 1 },
            lockVersion: { increment: 1 },
            lastSeenAt: now,
            refreshExpiresAt: new Date(now.getTime() + idleMs),
            ipAddress: device?.ipAddress ?? session.ipAddress,
            country: device?.country ?? session.country,
            userAgent: device?.userAgent ?? session.userAgent,
            fingerprintHash: device?.fingerprintHash ?? session.fingerprintHash,
          },
        });

        if (cas.count !== 1) {
          throw new AuthPlatformError(
            'AUTH_INVALID_TOKEN',
            'Concurrent refresh lost the CAS race; retry with the latest refresh token.',
            { reason: 'concurrent_refresh' },
          );
        }

        const updated = await tx.session.findUniqueOrThrow({ where: { id: session.id } });

        if (updated.fingerprintHash) {
          await tx.trustedDevice.updateMany({
            where: {
              userId: updated.userId,
              fingerprintHash: updated.fingerprintHash,
              revokedAt: null,
            },
            data: { lastSeenAt: now },
          });
        }

        await tx.authAuditLog.create({
          data: {
            userId: updated.userId,
            sessionId: updated.id,
            action: 'REFRESH',
            ipAddress: updated.ipAddress,
            country: updated.country,
            userAgent: updated.userAgent,
            fingerprint: updated.fingerprintHash,
            metadata: {
              refreshGeneration: updated.refreshGeneration,
              familyId: updated.familyId,
            },
          },
        });

        return updated;
      });
    } catch (error) {
      if (
        error instanceof AuthPlatformError
        && error.code === 'AUTH_INVALID_TOKEN'
        && (error.details as { reason?: string } | undefined)?.reason === 'concurrent_refresh'
      ) {
        // Winner may still be minting access — wait briefly for grace cache.
        const grace = await this.waitForGraceRotation(session.id, presentedHash);
        if (grace) return grace;
      }
      throw error;
    }
    if (timing) timing.dbMs += Number(process.hrtime.bigint() - tDb1) / 1e6;

    const tTok1 = process.hrtime.bigint();
    const accessToken = this.tokens.issueAccessToken({
      userId: user.id,
      sessionId: rotated.id,
      sessionVersion: user.sessionVersion,
      permissionVersion: user.permissionVersion,
    });
    if (timing) timing.tokenMs += Number(process.hrtime.bigint() - tTok1) / 1e6;

    const tDb2 = process.hrtime.bigint();
    const trustedDevice = await this.isTrustedDevice(user.id, rotated.fingerprintHash);
    if (timing) timing.dbMs += Number(process.hrtime.bigint() - tDb2) / 1e6;

    const result: SessionAuthResult = {
      session: rotated,
      user: {
        id: user.id,
        onixId: user.onixId,
        sessionVersion: user.sessionVersion,
        permissionVersion: user.permissionVersion,
        isAdmin: user.isAdmin,
        deletedAt: user.deletedAt,
      },
      accessToken,
      refreshToken: nextRefresh.token,
      trustedDevice,
    };
    this.rememberGraceRotation(session.id, presentedHash, result);
    return result;
  }

  private rememberGraceRotation(
    sessionId: string,
    presentedHash: string,
    result: SessionAuthResult,
  ): void {
    this.rotationGraceCache.set(sessionId, {
      presentedHash,
      result,
      cachedAt: Date.now(),
    });
    if (this.rotationGraceCache.size > 500) {
      const cutoff = Date.now() - refreshReuseGraceMs();
      for (const [id, entry] of this.rotationGraceCache) {
        if (entry.cachedAt < cutoff) this.rotationGraceCache.delete(id);
      }
    }
  }

  private takeGraceRotation(
    sessionId: string,
    presentedHash: string,
  ): SessionAuthResult | null {
    const entry = this.rotationGraceCache.get(sessionId);
    if (!entry) return null;
    if (entry.presentedHash !== presentedHash) return null;
    if (Date.now() - entry.cachedAt > refreshReuseGraceMs()) {
      this.rotationGraceCache.delete(sessionId);
      return null;
    }
    return entry.result;
  }

  /** Poll grace cache — winner often finishes minting access a few ms after CAS. */
  private async waitForGraceRotation(
    sessionId: string,
    presentedHash: string,
    attempts = 15,
    delayMs = 25,
  ): Promise<SessionAuthResult | null> {
    for (let i = 0; i < attempts; i += 1) {
      const hit = this.takeGraceRotation(sessionId, presentedHash);
      if (hit) return hit;
      if (i + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return null;
  }

  private async handleRefreshReuse(
    session: Session,
    presentedHash: string,
    device?: DeviceContext,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'REFRESH_REUSE' },
      });

      await tx.user.update({
        where: { id: session.userId },
        data: { sessionVersion: { increment: 1 } },
      });

      await tx.securityEvent.create({
        data: {
          type: 'REFRESH_TOKEN_THEFT',
          status: 'AUTO_MITIGATED',
          userId: session.userId,
          sessionId: session.id,
          severity: 90,
          ipAddress: device?.ipAddress ?? session.ipAddress,
          country: device?.country ?? session.country,
          payload: {
            familyId: session.familyId,
            presentedHashPrefix: presentedHash.slice(0, 8),
            refreshGeneration: session.refreshGeneration,
          },
          resolvedAt: now,
        },
      });

      await tx.authAuditLog.create({
        data: {
          userId: session.userId,
          sessionId: session.id,
          action: 'SESSION_REVOKED',
          ipAddress: device?.ipAddress ?? session.ipAddress,
          country: device?.country ?? session.country,
          userAgent: device?.userAgent ?? session.userAgent,
          fingerprint: device?.fingerprintHash ?? session.fingerprintHash,
          metadata: { reason: 'REFRESH_REUSE', familyId: session.familyId },
        },
      });
    });
  }

  private async resolveUserAccountLock(
    user: User,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<User> {
    if (!user.deletedAt) return user;
    if (isBanActive(user)) {
      throw new AuthPlatformError('AUTH_ACCOUNT_LOCKED', 'Account is locked or missing.', {
        ban: banPublicInfo(user),
      });
    }
    return db.user.update({ where: { id: user.id }, data: BAN_CLEAR_DATA });
  }

  private assertSessionUsable(session: Session, now: Date): void {
    if (session.revokedAt) {
      throw new AuthPlatformError('AUTH_SESSION_EXPIRED', 'Session has been revoked.');
    }
    if (session.absoluteExpiresAt.getTime() <= now.getTime()) {
      throw new AuthPlatformError('AUTH_SESSION_EXPIRED', 'Session absolute lifetime exceeded.');
    }
    if (session.refreshExpiresAt.getTime() <= now.getTime()) {
      throw new AuthPlatformError('AUTH_SESSION_EXPIRED', 'Session idle/refresh lifetime exceeded.');
    }
    const idleMs = session.rememberMe ? SESSION_REMEMBER_IDLE_TTL_MS : SESSION_IDLE_TTL_MS;
    if (session.lastSeenAt.getTime() + idleMs <= now.getTime()) {
      throw new AuthPlatformError('AUTH_SESSION_EXPIRED', 'Session idle timeout exceeded.');
    }
  }

  private async enforceSessionLimit(
    tx: Prisma.TransactionClient,
    userId: bigint,
    now: Date,
  ): Promise<void> {
    const active = await tx.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'asc' },
      select: { id: true },
    });
    const overflow = active.length + 1 - MAX_SESSIONS_PER_USER;
    if (overflow <= 0) return;

    const toRevoke = active.slice(0, overflow);
    for (const row of toRevoke) {
      await tx.session.update({
        where: { id: row.id },
        data: { revokedAt: now, revokeReason: 'SESSION_LIMIT' },
      });
      await tx.authAuditLog.create({
        data: {
          userId,
          sessionId: row.id,
          action: 'SESSION_REVOKED',
          metadata: { reason: 'SESSION_LIMIT' },
        },
      });
    }
  }
}

function newId(): string {
  return randomBytes(16).toString('hex');
}
