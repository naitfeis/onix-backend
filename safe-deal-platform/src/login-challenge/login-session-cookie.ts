import { AuthPlatformError } from '../auth-v2/auth-errors';

const LOGIN_SESSION_COOKIE = process.env.AUTH_COOKIE_SECURE === 'false' ? 'onix_ls' : '__Host-onix_ls';

export function loginSessionCookieName(): string {
  return LOGIN_SESSION_COOKIE;
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
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readLoginSessionId(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== loginSessionCookieName()) continue;
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
