/**
 * Strip markup / dangerous URL schemes from user-authored review text.
 * Reviews are rendered as React text (already XSS-safe), but we still
 * neutralize stored payloads so future Markdown/HTML renderers cannot be abused.
 */
export function sanitizeReviewText(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  let text = String(raw);
  // Remove HTML/XML tags (script, img, a, …).
  text = text.replace(/<\/?[^>]+>/g, '');
  // Neutralize javascript:/data:/vbscript: URL schemes in leftover markdown-ish links.
  text = text.replace(/\b(?:javascript|data|vbscript)\s*:/gi, '');
  // Collapse control chars except newline/tab.
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  text = text.trim();
  if (!text) return undefined;
  return text.slice(0, 1000);
}
