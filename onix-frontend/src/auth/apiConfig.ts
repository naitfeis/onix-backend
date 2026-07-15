/**
 * API origin resolution for Website same-origin cookies (__Host-onix_rt).
 *
 * - Empty / unset VITE_API_URL → relative "/api/..." (SPA origin; Vercel rewrite / Vite proxy)
 * - Absolute URL → legacy cross-origin (works today; cookies will NOT stick for Auth V2)
 *
 * vercel.json is intentionally not modified in Phase A: existing /api rewrite is correct.
 */

export function resolveApiBase(explicit?: string): string {
  const raw = explicit !== undefined
    ? explicit
    : (import.meta.env.VITE_API_URL as string | undefined);
  return raw?.trim().replace(/\/+$/, '') ?? '';
}

/** Same-origin relative API (required for __Host- refresh cookie). */
export function isSameOriginApi(base: string = resolveApiBase()): boolean {
  return base === '';
}

/**
 * Send cookies only on same-origin API calls.
 * Never force credentials on absolute cross-origin bases (avoids CORS credential failures).
 */
export function shouldIncludeCredentials(base: string = resolveApiBase()): boolean {
  return isSameOriginApi(base);
}

export function buildApiUrl(path: string, base: string = resolveApiBase()): string {
  if (!path.startsWith('/')) {
    throw new Error(`API path must start with "/": ${path}`);
  }
  return `${base}${path}`;
}
