/**
 * Public label — display name only (no Telegram @username).
 * Kept as `publicAt` for existing imports; does not add "@".
 */
export function publicAt(username: string | null | undefined): string {
  const name = (username ?? '').replace(/^@+/, '').trim();
  return name || 'Пользователь';
}
