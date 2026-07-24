/**
 * Client-facing avatar URL — same-origin so RU browsers never hit t.me CDN.
 * Source Telegram photo_url stays in DB; GET /api/avatars/:id fetches + caches.
 */
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
