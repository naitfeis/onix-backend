/**
 * Admin refresh cookie — separate from customer `__Host-onix_rt`.
 * SameSite=Strict; Secure+__Host- in production.
 */

export function adminRefreshCookieName(): string {
  const secure = process.env.AUTH_COOKIE_SECURE !== 'false';
  return secure ? '__Host-onix_admin_rt' : 'onix_admin_rt';
}

export function buildAdminRefreshCookieHeader(token: string, maxAgeSeconds: number): string {
  const secure = process.env.AUTH_COOKIE_SECURE !== 'false';
  const parts = [
    `${adminRefreshCookieName()}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearAdminRefreshCookieHeader(): string {
  const secure = process.env.AUTH_COOKIE_SECURE !== 'false';
  const parts = [
    `${adminRefreshCookieName()}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export function readAdminRefreshTokenFromCookie(cookieHeader: string | undefined): string | undefined {
  return readCookie(cookieHeader, adminRefreshCookieName());
}
