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
