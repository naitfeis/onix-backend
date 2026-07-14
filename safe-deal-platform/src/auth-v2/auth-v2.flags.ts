/** Feature flags for Website auth v2 (ADR-035). Defaults keep production behaviour unchanged. */

export function isNewAuthEnabled(): boolean {
  const value = process.env.USE_NEW_AUTH;
  if (value === undefined || value === '') return false;
  return value === '1' || value.toLowerCase() === 'true';
}
