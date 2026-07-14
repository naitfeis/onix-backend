import { AuthPlatformError } from './auth-errors';

/**
 * Refresh cookie helpers (ADR-003 / ADD cookie strategy).
 * No cookie-parser dependency — parse/set Cookie headers directly.
 */

export function refreshCookieName(): string {
  // __Host- requires Secure + Path=/ + no Domain. For local HTTP tests use plain name.
  const secure = process.env.AUTH_COOKIE_SECURE !== 'false';
  return secure ? '__Host-onix_rt' : 'onix_rt';
}

export function buildRefreshCookieHeader(token: string, maxAgeSeconds: number): string {
  const secure = process.env.AUTH_COOKIE_SECURE !== 'false';
  const parts = [
    `${refreshCookieName()}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearRefreshCookieHeader(): string {
  const secure = process.env.AUTH_COOKIE_SECURE !== 'false';
  const parts = [
    `${refreshCookieName()}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export function readRefreshTokenFromCookie(cookieHeader: string | undefined): string | undefined {
  return readCookie(cookieHeader, refreshCookieName());
}

export function assertCsrfHeader(headers: Record<string, string | string[] | undefined>): void {
  const raw = headers['x-onix-csrf'] ?? headers['X-ONIX-CSRF'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value !== '1') {
    throw new AuthPlatformError('AUTH_CSRF_REJECTED', 'CSRF header X-ONIX-CSRF: 1 is required.');
  }
}
