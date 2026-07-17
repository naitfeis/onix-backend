/**
 * ONIX ID display/lookup helpers.
 * DB stores canonical `ONIX-000001`; UI shows `ONIX-1`. Lookup accepts both.
 */

const ONIX_RE = /^(?:ONIX-)?(\d+)$/i;

/** Strip leading zeros for display: ONIX-000001 → ONIX-1 */
export function formatOnixId(onixId: string | null | undefined): string {
  if (!onixId) return '';
  const m = onixId.trim().match(ONIX_RE);
  if (!m) return onixId.trim();
  const n = BigInt(m[1]).toString();
  return `ONIX-${n}`;
}

/** Candidates for DB lookup (canonical padded + short + bare digits). */
export function onixIdLookupCandidates(raw: string): string[] {
  const s = raw.trim();
  if (!s) return [];
  const m = s.match(ONIX_RE);
  if (!m) return [s];
  const bare = BigInt(m[1]).toString();
  const padded = bare.padStart(6, '0');
  const out = [`ONIX-${bare}`, `ONIX-${padded}`, bare];
  return [...new Set(out)];
}
