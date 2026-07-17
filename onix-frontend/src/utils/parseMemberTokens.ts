/**
 * Parse group-member tokens from free text.
 * Accepts: "1 2 3", "ONIX-1, ONIX-2", "@user1 @user2"
 */
export function parseMemberTokens(raw: string): string[] {
  const parts = raw.trim().split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const token = part.replace(/^@+/, '');
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}
