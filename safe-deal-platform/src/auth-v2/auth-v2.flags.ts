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
