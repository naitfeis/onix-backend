/**
 * API origin for Website — single-origin Amvera production.
 *
 * Browser always uses relative `/api/...` on https://www.onixtg.shop
 * (SPA+API same origin on Amvera). Absolute backends are ignored.
 *
 * Local: empty base + Vite `/api` proxy → Nest (or VITE_API_PROXY_TARGET).
 */

function normalizeConfiguredBase(raw: string | undefined): string {
  const base = raw?.trim().replace(/\/+$/, '') ?? '';
  if (!base) return '';
  // Never let the browser call an absolute API host (Render, etc.).
  if (/^https?:\/\//i.test(base)) return '';
  // `/api` as base would produce `/api/api/...` with buildApiUrl — treat as empty.
  if (base === '/api') return '';
  return base;
}

export function resolveApiBase(explicit?: string): string {
  const raw = explicit !== undefined
    ? explicit
    : (import.meta.env.VITE_API_URL as string | undefined);
  return normalizeConfiguredBase(raw);
}

/** Same-origin relative API (required for __Host- cookies on www.onixtg.shop). */
export function isSameOriginApi(base: string = resolveApiBase()): boolean {
  return base === '';
}

/**
 * Send cookies on same-origin API calls (always true after single-origin migration).
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
