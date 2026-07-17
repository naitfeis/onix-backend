/** Show @nick only for real Telegram usernames; never @ONIX-7 / @12345 / @user. */
const TG_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

export function publicAt(username: string | null | undefined): string {
  const nick = (username ?? '').replace(/^@+/, '').trim();
  if (!nick || nick === 'user' || nick === 'ONIX') return nick === 'ONIX' ? 'ONIX' : 'без ника';
  if (/^\d+$/.test(nick) || /^ONIX-/i.test(nick) || !TG_USERNAME_RE.test(nick)) return 'без ника';
  return `@${nick}`;
}
