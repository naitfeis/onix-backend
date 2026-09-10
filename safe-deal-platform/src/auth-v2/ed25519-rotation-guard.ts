/**
 * Pure guards for Ed25519 PREVIOUS retirement — used by rotate-ed25519 script + tests.
 * Runbook discipline alone is not enough; retire must fail closed under TTL.
 */

export function accessTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.AUTH_ACCESS_TTL_SECONDS ?? 900);
  return Number.isFinite(raw) && raw > 0 ? raw : 900;
}

export function minRetirePreviousMinutes(env: NodeJS.ProcessEnv = process.env): number {
  return Math.ceil(accessTtlSeconds(env) / 60);
}

export function assertMayRetirePrevious(
  confirmMinutes: number,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const min = minRetirePreviousMinutes(env);
  if (!Number.isFinite(confirmMinutes) || confirmMinutes < min) {
    throw new Error(
      `Refusing to retire PREVIOUS: need --confirm-ttl-elapsed-minutes>=${min} ` +
        `(AUTH_ACCESS_TTL_SECONDS=${accessTtlSeconds(env)}). ` +
        'Dropping PREVIOUS earlier tears live access JWTs mid-escrow.',
    );
  }
}
