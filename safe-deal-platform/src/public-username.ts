/**
 * Public display handle: Telegram @username only.
 * Never expose numeric telegramId, firstName/displayName, or ONIX id as "username".
 */

/** Telegram username: 5–32 chars, starts with a letter, [A-Za-z0-9_]. */
const TG_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/**
 * Returns a cleaned Telegram nick (no @), or null if missing/invalid.
 * Rejects pure digits (telegram user id mistaken for nick) and ONIX-* ids.
 */
export function publicTelegramNick(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const nick = raw.replace(/^@+/, '').trim();
  if (!nick) return null;
  if (/^\d+$/.test(nick)) return null;
  if (/^ONIX-/i.test(nick)) return null;
  if (/^PENDING-/i.test(nick)) return null;
  if (!TG_USERNAME_RE.test(nick)) return null;
  return nick;
}

/** API `username` field — nick only; placeholder when user has no public Telegram username. */
export function publicUsername(telegramNick: string | null | undefined): string {
  return publicTelegramNick(telegramNick) ?? 'user';
}
