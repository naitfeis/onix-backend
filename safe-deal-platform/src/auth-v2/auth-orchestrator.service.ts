import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthPlatformError } from './auth-errors';
import { AUTH_EVENT_PUBLISHER, AuthEventPublisher } from './auth-events';
import { isDualIssueSessionEnabled } from './auth-v2.flags';
import { AuthRolloutService } from './auth-rollout.service';
import { IdentityService } from './identity.service';
import { SESSION_ABSOLUTE_TTL_MS, SESSION_IDLE_TTL_MS, SESSION_REMEMBER_IDLE_TTL_MS } from './session.constants';
import { type DeviceContext, type SessionAuthResult, SessionService } from './session.service';
import { TelegramLoginVerifier, type TelegramLoginPayload } from './telegram-login.verifier';

export interface LoginTelegramCommand {
  telegram: TelegramLoginPayload;
  rememberMe?: boolean;
  device?: DeviceContext;
}

/** Legacy Telegram entry surfaces that may dual-issue a Website Session (Phase 3.2). */
export type LegacyAuthSource = 'telegram-mini' | 'telegram-login';

export interface DualIssueSessionResult {
  sessionId: string;
  familyId: string;
  /** Opaque refresh exists only in-process; never attached to Mini App responses in 3.2. */
  refreshTokenIssued: true;
}

@Injectable()
export class AuthOrchestrator {
  private readonly logger = new Logger(AuthOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramLoginVerifier,
    private readonly identities: IdentityService,
    private readonly sessions: SessionService,
    @Inject(AUTH_EVENT_PUBLISHER) private readonly events: AuthEventPublisher,
    @Optional() private readonly rollout?: AuthRolloutService,
  ) {}

  async loginWithTelegram(command: LoginTelegramCommand): Promise<SessionAuthResult & {
    refreshMaxAgeSeconds: number;
  }> {
    try {
      const identity = this.telegram.verify(command.telegram);

      const { user, session, refreshToken, trustedDevice } = await this.prisma.$transaction(async (tx) => {
        const user = await this.identities.upsertTelegramUser(tx, identity);
        const created = await this.sessions.createSessionInTransaction(tx, user, {
          userId: user.id,
          rememberMe: command.rememberMe,
          device: command.device,
          provider: 'TELEGRAM',
          amr: ['telegram'],
        });
        return { user, ...created };
      });

      const tokens = this.sessions.issueTokensForSession(
        user, session.id, refreshToken, ['telegram'], trustedDevice,
      );

      this.logger.log(JSON.stringify({
        msg: 'auth_v2_login_success',
        userId: user.id.toString(),
        sessionId: session.id,
        provider: 'TELEGRAM',
      }));

      await this.events.publish('UserLoggedIn.v1', {
        userId: user.id.toString(),
        sessionId: session.id,
        provider: 'TELEGRAM',
      });
      await this.events.publish('SessionCreated.v1', {
        userId: user.id.toString(),
        sessionId: session.id,
        familyId: session.familyId,
      });

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
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        trustedDevice,
        refreshMaxAgeSeconds: refreshMaxAgeSeconds(session.rememberMe),
      };
    } catch (error) {
      this.logger.warn(JSON.stringify({
        msg: 'auth_v2_login_failed',
        code: error instanceof AuthPlatformError ? error.code : 'AUTH_INTERNAL',
      }));
      await this.events.publish('UserLoginFailed.v1', {
        reason: error instanceof AuthPlatformError ? error.code : 'AUTH_INTERNAL',
      });
      throw error;
    }
  }

  /**
   * Phase 3.2 — Session dual-issue for legacy Telegram login paths.
   *
   * When AUTH_DUAL_ISSUE_SESSION=true, creates one Website Session for the already-upserted User
   * (refresh hash + LOGIN_SUCCESS audit via SessionService). Fail-open: never breaks Mini App /
   * telegram-login contracts. Opaque refresh and Ed25519 access are discarded (not returned).
   *
   * Cookie Set-Cookie is intentionally not applied here (AUTH_DUAL_ISSUE_SET_COOKIE reserved).
   */
  async dualIssueSessionAfterLegacyLogin(
    userId: bigint,
    source: LegacyAuthSource,
    device?: DeviceContext,
  ): Promise<DualIssueSessionResult | null> {
    if (!isDualIssueSessionEnabled()) return null;

    try {
      const result = await this.sessions.createSession({
        userId,
        clientType: source === 'telegram-mini' ? 'MINI_APP' : 'TELEGRAM_WIDGET',
        provider: 'TELEGRAM',
        amr: ['telegram'],
        device,
      });

      // Opaque refresh is created + hashed inside SessionService; discard plaintext deliberately.
      void result.refreshToken;
      void result.accessToken;

      this.logger.log(JSON.stringify({
        msg: 'auth_dual_issue_session_success',
        userId: userId.toString(),
        sessionId: result.session.id,
        source,
        familyId: result.session.familyId,
      }));

      this.rollout?.observeAuthPath('dual_issue_session', {
        userId: userId.toString(),
        sessionId: result.session.id,
        source,
      });

      await this.events.publish('SessionCreated.v1', {
        userId: userId.toString(),
        sessionId: result.session.id,
        familyId: result.session.familyId,
        source,
        dualIssue: true,
      });

      return {
        sessionId: result.session.id,
        familyId: result.session.familyId,
        refreshTokenIssued: true,
      };
    } catch (error) {
      this.logger.warn(JSON.stringify({
        msg: 'auth_dual_issue_session_failed',
        userId: userId.toString(),
        source,
        code: error instanceof AuthPlatformError ? error.code : 'AUTH_INTERNAL',
      }));
      return null;
    }
  }

  async refresh(
    refreshToken: string,
    device?: DeviceContext,
  ): Promise<SessionAuthResult & { refreshMaxAgeSeconds: number }> {
    try {
      const result = await this.sessions.rotateRefresh(refreshToken, device);
      this.logger.log(JSON.stringify({
        msg: 'auth_v2_refresh_success',
        userId: result.user.id.toString(),
        sessionId: result.session.id,
      }));
      await this.events.publish('RefreshRotated.v1', {
        userId: result.user.id.toString(),
        sessionId: result.session.id,
        refreshGeneration: result.session.refreshGeneration,
      });
      return {
        ...result,
        refreshMaxAgeSeconds: refreshMaxAgeSeconds(result.session.rememberMe),
      };
    } catch (error) {
      if (error instanceof AuthPlatformError && error.code === 'AUTH_REFRESH_REUSED') {
        await this.events.publish('RefreshReuseDetected.v1', {
          message: error.message,
        });
      }
      throw error;
    }
  }

  async logout(sessionId: string, userId: bigint): Promise<void> {
    await this.sessions.revokeSession(sessionId, 'LOGOUT', userId);
    await this.events.publish('Logout.v1', {
      userId: userId.toString(),
      sessionId,
    });
    await this.events.publish('SessionRevoked.v1', {
      userId: userId.toString(),
      sessionId,
      reason: 'LOGOUT',
    });
  }

  async logoutAll(userId: bigint): Promise<{ revoked: number; sessionVersion: number }> {
    const result = await this.sessions.revokeAllSessions(userId, 'LOGOUT_ALL');
    await this.events.publish('LogoutAll.v1', {
      userId: userId.toString(),
      revoked: result.revoked,
      sessionVersion: result.sessionVersion,
    });
    await this.events.publish('SessionsGloballyInvalidated.v1', {
      userId: userId.toString(),
      sessionVersion: result.sessionVersion,
    });
    return result;
  }
}

function refreshMaxAgeSeconds(rememberMe: boolean): number {
  const idle = rememberMe ? SESSION_REMEMBER_IDLE_TTL_MS : SESSION_IDLE_TTL_MS;
  return Math.floor(Math.min(idle, SESSION_ABSOLUTE_TTL_MS) / 1000);
}
