/**
 * Client-facing avatar URL — same-origin so RU browsers never hit t.me CDN.
 * Source Telegram photo_url stays in DB; GET /api/avatars/:id fetches + caches.
 */

export const AVATAR_MAX_BYTES = 512 * 1024;
export const AVATAR_ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function publicAvatarUrl(userId: bigint | string | number): string {
  return `/api/avatars/${userId.toString()}`;
}

/**
 * Always point clients at our proxy. Missing / private Telegram photos → 404 → initials.
 * `sourceUrl` kept for call-site clarity (DB still holds t.me / tg:profile markers).
 */
export function clientAvatarUrl(
  userId: bigint | string | number,
  _sourceUrl?: string | null | undefined,
): string {
  return publicAvatarUrl(userId);
}

export function isAllowedTelegramAvatarHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 't.me'
    || host.endsWith('.t.me')
    || host === 'telegram.org'
    || host.endsWith('.telegram.org')
    || host.endsWith('.telesco.pe')
    || host === 'telegram-cdn.org'
    || host.endsWith('.telegram-cdn.org')
    || host === 'api.telegram.org'
  );
}

/** Google profile photos (GIS `picture`) — lh3/lh4/…googleusercontent.com only. */
export function isAllowedGoogleAvatarHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
}

export function isAllowedAvatarHost(hostname: string): boolean {
  return isAllowedTelegramAvatarHost(hostname) || isAllowedGoogleAvatarHost(hostname);
}

/** Reject private / link-local / weird hosts even if somehow allowlisted later. */
export function isBlockedAvatarIpLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '0.0.0.0') return true;
  if (host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.')) return true;
  if (host.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  return false;
}

export function assertSafeAvatarUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (isBlockedAvatarIpLiteral(parsed.hostname)) return null;
  if (!isAllowedAvatarHost(parsed.hostname)) return null;
  return parsed;
}
