/**
 * Privacy-first Risk Engine (Slice 2).
 * Separate from registration AbuseMarker RiskScoreService.
 */

export type RiskAction = 'ALLOW' | 'MONITOR' | 'STEP_UP' | 'BLOCK';

export type RiskActionKind = 'LOGIN' | 'WITHDRAW' | 'PURCHASE' | 'SELL' | 'TRANSFER' | 'SPEND';

export type RiskFactor =
  | 'NEW_DEVICE'
  | 'NEW_IP'
  | 'NEW_COUNTRY'
  | 'LARGE_AMOUNT'
  | 'NEW_PAYOUT_DEST'
  | 'HIGH_SESSION_RISK'
  | 'CONTEXT_SHIFT'
  | 'BAN_EVASION'
  | 'ACCOUNT_SALE_PROCEEDS'
  | 'SUSPICIOUS_FUNDS'
  | 'SECURITY_LOCK_ACTIVE'
  /** Seller already failed to deliver to THIS buyer — a second deal is a hard block. */
  | 'REPEAT_VICTIM';

export type RiskDecision = {
  action: RiskAction;
  score: number;
  factors: RiskFactor[];
  /** Human-readable reason for clients / audit (no secrets). */
  reason: string;
  level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
};

export type RiskEventDraft = {
  type:
    | 'SESSION_ANOMALY'
    | 'IMPOSSIBLE_TRAVEL'
    | 'ACCOUNT_TAKEOVER_SUSPECTED'
    | 'BAN_EVASION'
    | 'HIGH_RISK_THRESHOLD'
    | 'SECURITY_LOCK'
    | 'OFF_PLATFORM_PAYMENT'
    | 'EXTERNAL_CONTACT'
    | 'SPAM'
    | 'DUPLICATE_LISTING'
    | 'SUSPICIOUS_LINK'
    | 'FRAUD_ATTEMPT';
  severity: number;
  ipAddress?: string | null;
  country?: string | null;
  payload: Record<string, unknown>;
};

export type LoginRiskInput = {
  userId: bigint;
  /** Server deviceId (HMAC); null if signals insufficient. */
  deviceId: string | null;
  ipAddress?: string | null;
  country?: string | null;
  /** Context only — never enters deviceId HMAC. */
  timezone?: string | null;
  locale?: string | null;
  trustedDevice: boolean;
};

export type WithdrawRiskInput = {
  userId: bigint;
  amountCents: bigint;
  sessionId?: string | null;
  /** Optional payout destination (AI / future wallet field). */
  payoutDestination?: string | null;
  ipAddress?: string | null;
  country?: string | null;
  /** Slice 3 — CONFIRMED Telegram MFA challenge to consume. */
  stepUpChallengeId?: string | null;
};
