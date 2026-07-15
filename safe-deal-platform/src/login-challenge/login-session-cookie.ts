import { AuthPlatformError } from '../auth-v2/auth-errors';

/**
 * Login-session CSRF cookie (Website bot login).
 *
 * Single-origin (www.onixtg.shop/api → Vercel rewrite → Render):
 *   Secure/prod: `__Host-onix_ls` + SameSite=Lax + Secure
 * Local HTTP (`AUTH_COOKIE_SECURE=false`): `onix_ls` + SameSite=Lax
 *
 * SameSite=None is not required when the browser only talks to one origin.
 */
export function loginSessionCookieName(): string {
  return process.env.AUTH_COOKIE_SECURE === 'false' ? 'onix_ls' : '__Host-onix_ls';
}

export function buildLoginSessionCookieHeader(loginSessionId: string, maxAgeSeconds: number): string {
  const secure = process.env.AUTH_COOKIE_SECURE !== 'false';
  const parts = [
    `${loginSessionCookieName()}=${encodeURIComponent(loginSessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  // __Host- forbids Domain=. No Domain attribute (host-only on www.onixtg.shop).
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readLoginSessionId(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const expected = loginSessionCookieName();
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== expected) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export function assertLoginSessionMatch(cookieHeader: string | undefined, expected: string): void {
  const actual = readLoginSessionId(cookieHeader);
  if (!actual || actual !== expected) {
    throw new AuthPlatformError('AUTH_CSRF_REJECTED', 'Login session cookie mismatch.');
  }
}
