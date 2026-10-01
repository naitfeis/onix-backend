import type { RiskAction, RiskFactor } from './risk-engine.types';

/** Factor weights for Slice 2 scoring. */
export const RISK_WEIGHT: Record<RiskFactor, number> = {
  NEW_DEVICE: 40,
  NEW_IP: 25,
  NEW_COUNTRY: 20,
  /** Alone must reach STEP_UP (≥ RISK_STEP_UP_SCORE default 50). */
  LARGE_AMOUNT: 50,
  NEW_PAYOUT_DEST: 25,
  HIGH_SESSION_RISK: 15,
  /** Timezone/locale shift — context only, never sole STEP_UP driver. */
  CONTEXT_SHIFT: 5,
  BAN_EVASION: 70,
  ACCOUNT_SALE_PROCEEDS: 35,
  SUSPICIOUS_FUNDS: 40,
  SECURITY_LOCK_ACTIVE: 100,
  /** Hard block: the pair already has a proven failed deal. */
  REPEAT_VICTIM: 100,
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

export function riskLockThreshold(): number {
  const n = Number(process.env.RISK_LOCK_SCORE ?? 70);
  return Number.isFinite(n) && n > 0 ? n : 70;
}

export function riskCriticalThreshold(): number {
  const n = Number(process.env.RISK_CRITICAL_SCORE ?? 85);
  return Number.isFinite(n) && n > 0 ? n : 85;
}

export function riskLevel(score: number, factors: RiskFactor[]): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (
    factors.includes('BAN_EVASION')
    || factors.includes('SECURITY_LOCK_ACTIVE')
    || factors.includes('REPEAT_VICTIM')
    || score >= riskCriticalThreshold()
  ) {
    return 'CRITICAL';
  }
  if (score >= riskLockThreshold()) return 'HIGH';
  if (score >= riskStepUpThreshold()) return 'MEDIUM';
  return 'LOW';
}

export function decideAction(score: number, factors: RiskFactor[]): RiskAction {
  const hard = factors.filter((f) => f !== 'CONTEXT_SHIFT');
  if (hard.length === 0) {
    if (factors.includes('CONTEXT_SHIFT') && score >= riskMonitorThreshold()) return 'MONITOR';
    return 'ALLOW';
  }
  if (
    hard.includes('SECURITY_LOCK_ACTIVE')
    || hard.includes('BAN_EVASION')
    || hard.includes('REPEAT_VICTIM')
  ) {
    return 'BLOCK';
  }
  if (
    score >= riskLockThreshold()
    && (hard.includes('ACCOUNT_SALE_PROCEEDS') || hard.includes('SUSPICIOUS_FUNDS'))
  ) {
    return 'BLOCK';
  }
  if (score >= riskStepUpThreshold()) return 'STEP_UP';
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
