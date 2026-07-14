/** Feature flags for Website auth v2 (ADR-035). Defaults keep production behaviour unchanged. */

export function isNewAuthEnabled(): boolean {
  return parseBoolEnv(process.env.USE_NEW_AUTH, false);
}

/**
 * Phase 3.1 — allow global AuthGuard to accept Ed25519 access JWTs alongside legacy HS256.
 * Independent of USE_NEW_AUTH (which stays false until Website cutover).
 * Default: false (EdDSA rejected on legacy-protected routes).
 */
export function isAcceptV2AccessEnabled(): boolean {
  return parseBoolEnv(process.env.AUTH_ACCEPT_V2_ACCESS, false);
}

/**
 * Phase 3.2 — after legacy Telegram login, also create a Website Session (refresh hash + audit).
 * Does not change HS256 response contracts. Opaque refresh is not returned to Mini App.
 * Default: false (legacy login behaviour unchanged).
 */
export function isDualIssueSessionEnabled(): boolean {
  return parseBoolEnv(process.env.AUTH_DUAL_ISSUE_SESSION, false);
}

/**
 * Reserved for a later Website path that may Set-Cookie refresh after dual-issue.
 * Never enabled for Mini App responses in Phase 3.2. Default: false.
 */
export function isDualIssueRefreshCookieEnabled(): boolean {
  return parseBoolEnv(process.env.AUTH_DUAL_ISSUE_SET_COOKIE, false);
}

/**
 * Phase 3.3 — canary percentage for Website new-auth cutover (0–100).
 * Default: 0 (nobody in canary). Independent of Mini App frozen path.
 */
export function getNewAuthCanaryPercent(): number {
  const raw = process.env.AUTH_NEW_AUTH_CANARY_PERCENT;
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return Math.floor(n);
}

/**
 * Phase 3.3 — emit structured rollout observation logs (Legacy/V2 path, canary hits).
 * Default: false (no extra log volume in production until ops enable it).
 */
export function isRolloutObserveEnabled(): boolean {
  return parseBoolEnv(process.env.AUTH_ROLLOUT_OBSERVE, false);
}

function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  return value === '1' || value.toLowerCase() === 'true';
}
