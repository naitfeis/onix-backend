/**
 * ONIX ID display helpers (FE).
 * API/canonical stays `ONIX-000001`; UI shows `ONIX-1`.
 */

const ONIX_RE = /^(?:ONIX-)?(\d+)$/i;

export function formatOnixId(onixId: string | null | undefined): string {
  if (!onixId) return '';
  const m = onixId.trim().match(ONIX_RE);
  if (!m) return onixId.trim();
  // Number() loses precision above 2^53 — IDs stay well below that.
  const n = String(Number(m[1]));
  if (!/^\d+$/.test(n) || n === 'NaN') return onixId.trim();
  return `ONIX-${n}`;
}

/** Prefer canonical from profile; for user input normalize to short ONIX-N for display. */
export function parseOnixIdInput(raw: string): string | null {
  const m = raw.trim().match(ONIX_RE);
  if (!m) return null;
  return `ONIX-${String(Number(m[1]))}`;
}
