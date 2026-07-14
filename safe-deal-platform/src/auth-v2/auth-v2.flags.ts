/** Feature flags for Website auth v2 (ADR-035). Defaults keep production behaviour unchanged. */

export function isNewAuthEnabled(): boolean {
  const value = process.env.USE_NEW_AUTH;
  if (value === undefined || value === '') return false;
  return value === '1' || value.toLowerCase() === 'true';
}

/**
 * Phase 3.1 — allow global AuthGuard to accept Ed25519 access JWTs alongside legacy HS256.
 * Independent of USE_NEW_AUTH (which stays false until Website cutover).
 * Default: false (EdDSA rejected on legacy-protected routes).
 */
export function isAcceptV2AccessEnabled(): boolean {
  const value = process.env.AUTH_ACCEPT_V2_ACCESS;
  if (value === undefined || value === '') return false;
  return value === '1' || value.toLowerCase() === 'true';
}

/**
 * Phase 3.2 — after legacy Telegram login, also create a Website Session (refresh hash + audit).
 * Does not change HS256 response contracts. Opaque refresh is not returned to Mini App.
 * Default: false (legacy login behaviour unchanged).
 */
export function isDualIssueSessionEnabled(): boolean {
  const value = process.env.AUTH_DUAL_ISSUE_SESSION;
  if (value === undefined || value === '') return false;
  return value === '1' || value.toLowerCase() === 'true';
}

/**
 * Reserved for a later Website path that may Set-Cookie refresh after dual-issue.
 * Never enabled for Mini App responses in Phase 3.2. Default: false.
 */
export function isDualIssueRefreshCookieEnabled(): boolean {
  const value = process.env.AUTH_DUAL_ISSUE_SET_COOKIE;
  if (value === undefined || value === '') return false;
  return value === '1' || value.toLowerCase() === 'true';
}
