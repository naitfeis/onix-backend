import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma, Session, SessionRevokeReason, User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthPlatformError } from './auth-errors';
import {
  DEFAULT_SESSION_RISK_SCORE,
  MAX_SESSIONS_PER_USER,
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

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async createSession(input: CreateSessionInput): Promise<SessionAuthResult> {
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user || user.deletedAt) {
      throw new AuthPlatformError('AUTH_ACCOUNT_LOCKED', 'Account is locked or missing.');
    }

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
    if (user.deletedAt) {
      throw new AuthPlatformError('AUTH_ACCOUNT_LOCKED', 'Account is locked or missing.');
    }
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

  async rotateRefresh(
    refreshToken: string,
    device?: DeviceContext,
  ): Promise<SessionAuthResult> {
    if (!refreshToken) {
      throw new AuthPlatformError('AUTH_REFRESH_MISSING', 'Refresh token is missing.');
    }

    const presentedHash = this.tokens.hashRefreshToken(refreshToken);
    const now = new Date();

    const current = await this.prisma.session.findUnique({
      where: { refreshTokenHash: presentedHash },
    });

    if (current) {
      return this.rotateCurrentSession(current, presentedHash, now, device);
    }

    const reused = await this.prisma.session.findFirst({
      where: { previousRefreshHash: presentedHash },
    });
    if (reused) {
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
    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.session.findUnique({ where: { id: claims.sid } }),
    ]);

    if (!user || user.deletedAt) {
      throw new AuthPlatformError('AUTH_ACCOUNT_LOCKED', 'Account is locked or missing.');
    }
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
  ): Promise<SessionAuthResult> {
    this.assertSessionUsable(session, now);

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.deletedAt) {
      throw new AuthPlatformError('AUTH_ACCOUNT_LOCKED', 'Account is locked or missing.');
    }

    const idleMs = session.rememberMe ? SESSION_REMEMBER_IDLE_TTL_MS : SESSION_IDLE_TTL_MS;
    const nextRefresh = this.tokens.issueRefreshToken();

    const rotated = await this.prisma.$transaction(async (tx) => {
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

    const accessToken = this.tokens.issueAccessToken({
      userId: user.id,
      sessionId: rotated.id,
      sessionVersion: user.sessionVersion,
      permissionVersion: user.permissionVersion,
    });

    return {
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
      trustedDevice: await this.isTrustedDevice(user.id, rotated.fingerprintHash),
    };
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
