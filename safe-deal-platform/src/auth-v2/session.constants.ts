/** Session lifetime defaults — ADR-028 / ADD v1.4 */

export const SESSION_IDLE_TTL_MS = Number(process.env.AUTH_SESSION_IDLE_MS ?? 14 * 24 * 60 * 60 * 1000);
export const SESSION_REMEMBER_IDLE_TTL_MS = Number(
  process.env.AUTH_SESSION_REMEMBER_IDLE_MS ?? 30 * 24 * 60 * 60 * 1000,
);
export const SESSION_ABSOLUTE_TTL_MS = Number(
  process.env.AUTH_SESSION_ABSOLUTE_MS ?? 90 * 24 * 60 * 60 * 1000,
);
export const MAX_SESSIONS_PER_USER = Number(process.env.AUTH_MAX_SESSIONS ?? 10);
export const TRUSTED_DEVICE_RISK_SCORE = 5;
export const DEFAULT_SESSION_RISK_SCORE = 20;

/**
 * Concurrent / multi-tab refresh: presenting the just-rotated previous token
 * within this window is treated as a race (return same tokens), not theft.
 * Outside the window → family revoke (REFRESH_REUSE).
 */
export function refreshReuseGraceMs(): number {
  const raw = Number(process.env.AUTH_REFRESH_REUSE_GRACE_MS ?? 30_000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}
