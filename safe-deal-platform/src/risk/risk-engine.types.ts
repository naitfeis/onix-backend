/**
 * Privacy-first Risk Engine (Slice 2).
 * Separate from registration AbuseMarker RiskScoreService.
 */

export type RiskAction = 'ALLOW' | 'MONITOR' | 'STEP_UP' | 'BLOCK';

export type RiskActionKind = 'LOGIN' | 'WITHDRAW';

export type RiskFactor =
  | 'NEW_DEVICE'
  | 'NEW_IP'
  | 'NEW_COUNTRY'
  | 'LARGE_AMOUNT'
  | 'NEW_PAYOUT_DEST'
  | 'HIGH_SESSION_RISK'
  | 'CONTEXT_SHIFT';

export type RiskDecision = {
  action: RiskAction;
  score: number;
  factors: RiskFactor[];
  /** Human-readable reason for clients / audit (no secrets). */
  reason: string;
};

export type RiskEventDraft = {
  type: 'SESSION_ANOMALY' | 'IMPOSSIBLE_TRAVEL' | 'ACCOUNT_TAKEOVER_SUSPECTED';
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
};
