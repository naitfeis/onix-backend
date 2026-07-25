import type { RiskAction, RiskFactor } from './risk-engine.types';

/** Factor weights for Slice 2 scoring. */
export const RISK_WEIGHT: Record<RiskFactor, number> = {
  NEW_DEVICE: 40,
  NEW_IP: 25,
  NEW_COUNTRY: 20,
  LARGE_AMOUNT: 30,
  NEW_PAYOUT_DEST: 25,
  HIGH_SESSION_RISK: 15,
  /** Timezone/locale shift — context only, never sole STEP_UP driver. */
  CONTEXT_SHIFT: 5,
};

export function riskMonitorThreshold(): number {
  const n = Number(process.env.RISK_MONITOR_SCORE ?? 25);
  return Number.isFinite(n) && n > 0 ? n : 25;
}

export function riskStepUpThreshold(): number {
  const n = Number(process.env.RISK_STEP_UP_SCORE ?? 50);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

/** Default 50_000 ₽. */
export function largeWithdrawCents(): bigint {
  const n = Number(process.env.RISK_WITHDRAW_LARGE_CENTS ?? 5_000_000);
  if (!Number.isFinite(n) || n <= 0) return 5_000_000n;
  return BigInt(Math.floor(n));
}

/**
 * When false, STEP_UP demotes to MONITOR (soft rollout).
 * Default true — high-risk withdraws require Telegram MFA (Slice 3).
 */
export function stepUpEnforceEnabled(): boolean {
  const raw = (process.env.RISK_STEP_UP_ENFORCE ?? 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

export function scoreFactors(factors: RiskFactor[]): number {
  const unique = [...new Set(factors)];
  return Math.min(100, unique.reduce((sum, f) => sum + RISK_WEIGHT[f], 0));
}

export function decideAction(score: number, factors: RiskFactor[]): RiskAction {
  if (score >= riskStepUpThreshold()) {
    // CONTEXT_SHIFT alone must never force STEP_UP (privacy: language change ≠ new device).
    const hard = factors.filter((f) => f !== 'CONTEXT_SHIFT');
    if (hard.length === 0) return 'MONITOR';
    return 'STEP_UP';
  }
  if (score >= riskMonitorThreshold()) return 'MONITOR';
  return 'ALLOW';
}

export function applyStepUpPolicy(action: RiskAction): RiskAction {
  if (action === 'STEP_UP' && !stepUpEnforceEnabled()) return 'MONITOR';
  return action;
}

export function decisionReason(action: RiskAction, factors: RiskFactor[]): string {
  if (factors.length === 0) return 'No elevated risk factors.';
  const list = factors.join(', ');
  switch (action) {
    case 'ALLOW':
      return `Low risk (${list}).`;
    case 'MONITOR':
      return `Monitored risk (${list}).`;
    case 'STEP_UP':
      return `Step-up required (${list}).`;
    case 'BLOCK':
      return `Blocked (${list}).`;
    default:
      return list;
  }
}
