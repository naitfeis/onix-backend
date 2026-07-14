import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  getNewAuthCanaryPercent,
  isAcceptV2AccessEnabled,
  isDualIssueSessionEnabled,
  isNewAuthEnabled,
  isRolloutObserveEnabled,
} from './auth-v2.flags';

/** Website / dual-accept rollout surface (Phase 3.3). Mini App remains frozen legacy. */
export type AuthRolloutMode = 'legacy' | 'dual' | 'new_auth';

export type AuthRolloutPath =
  | 'legacy_hs256'
  | 'v2_access'
  | 'dual_issue_session'
  | 'v2_login'
  | 'v2_refresh';

export type CanarySubject = {
  userId: bigint | string | number;
};

const CANARY_HASH_PREFIX = 'onix-auth-canary:v1:';

/**
 * Phase 3.3 — Canary & Rollout Infrastructure (ADR-035).
 *
 * Pure decision + observability. Does not change Mini App or legacy contracts.
 * Defaults: USE_NEW_AUTH=false, AUTH_NEW_AUTH_CANARY_PERCENT=0 → always legacy for new-auth.
 */
@Injectable()
export class AuthRolloutService {
  private readonly logger = new Logger(AuthRolloutService.name);

  /**
   * Deterministic canary membership: same userId always same bucket for a given percent.
   * Uses SHA-256 → first 4 bytes → uint32 % 100. No per-request randomness.
   */
  isCanaryEnabled(user: CanarySubject | bigint | string | number): boolean {
    const percent = getNewAuthCanaryPercent();
    if (percent <= 0) return false;
    if (percent >= 100) return true;
    const userId = normalizeUserId(user);
    const bucket = canaryBucket(userId);
    const enabled = bucket < percent;
    this.logCanaryDecision(userId, bucket, percent, enabled);
    return enabled;
  }

  /** Bucket 0–99 for diagnostics / dashboards. */
  getCanaryBucket(user: CanarySubject | bigint | string | number): number {
    return canaryBucket(normalizeUserId(user));
  }

  /**
   * True only when USE_NEW_AUTH is on AND user is inside canary percent.
   * With production defaults (USE_NEW_AUTH=false, percent=0) this is always false.
   */
  shouldUseNewAuthForUser(user: CanarySubject | bigint | string | number): boolean {
    if (!isNewAuthEnabled()) return false;
    const percent = getNewAuthCanaryPercent();
    if (percent <= 0) return false;
    if (percent >= 100) return true;
    return this.isCanaryEnabled(user);
  }

  /**
   * Prepared switching ladder (decision only — callers must not change Mini App):
   * Legacy → Dual (accept v2 / dual-issue flags) → New Auth (USE_NEW_AUTH + canary).
   */
  resolveAuthMode(user?: CanarySubject | bigint | string | number | null): AuthRolloutMode {
    if (user !== undefined && user !== null && this.shouldUseNewAuthForUser(user)) {
      return 'new_auth';
    }
    if (isAcceptV2AccessEnabled() || isDualIssueSessionEnabled()) {
      return 'dual';
    }
    return 'legacy';
  }

  /** Snapshot of flags for ops / health diagnostics (no secrets). */
  getRolloutSnapshot(): {
    useNewAuth: boolean;
    canaryPercent: number;
    acceptV2Access: boolean;
    dualIssueSession: boolean;
    observe: boolean;
    modeWithoutUser: AuthRolloutMode;
  } {
    return {
      useNewAuth: isNewAuthEnabled(),
      canaryPercent: getNewAuthCanaryPercent(),
      acceptV2Access: isAcceptV2AccessEnabled(),
      dualIssueSession: isDualIssueSessionEnabled(),
      observe: isRolloutObserveEnabled(),
      modeWithoutUser: this.resolveAuthMode(null),
    };
  }

  /**
   * Emergency rollback recipe — single ENV changes that restore prior behaviour.
   * Documented for ops; calling this only logs the recommended action.
   */
  logRollbackGuidance(reason: string): void {
    this.logger.warn(JSON.stringify({
      msg: 'auth_rollout_rollback',
      reason,
      actions: [
        'USE_NEW_AUTH=false',
        'AUTH_NEW_AUTH_CANARY_PERCENT=0',
        'optional: AUTH_ACCEPT_V2_ACCESS=false',
        'optional: AUTH_DUAL_ISSUE_SESSION=false',
      ],
      note: 'Mini App /telegram-* remain on legacy HS256 regardless.',
    }));
  }

  observeAuthPath(path: AuthRolloutPath, meta?: Record<string, unknown>): void {
    if (!isRolloutObserveEnabled()) return;
    this.logger.log(JSON.stringify({
      msg: 'auth_rollout_path',
      path,
      ...meta,
    }));
  }

  private logCanaryDecision(
    userId: string,
    bucket: number,
    percent: number,
    enabled: boolean,
  ): void {
    if (!isRolloutObserveEnabled() && !isNewAuthEnabled()) return;
    this.logger.log(JSON.stringify({
      msg: 'auth_rollout_canary',
      userId,
      bucket,
      percent,
      inCanary: enabled,
    }));
  }
}

export function canaryBucket(userId: string): number {
  const digest = createHash('sha256')
    .update(`${CANARY_HASH_PREFIX}${userId}`, 'utf8')
    .digest();
  const value = digest.readUInt32BE(0);
  return value % 100;
}

function normalizeUserId(user: CanarySubject | bigint | string | number): string {
  if (typeof user === 'object' && user !== null && 'userId' in user) {
    return String(user.userId);
  }
  return String(user);
}
