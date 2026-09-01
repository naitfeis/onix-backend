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

/**
 * Chat / caption text stored as Message.text (varchar 4500).
 * Same neutralization as reviews; empty leftover is '' so callers can reject.
 */
export function sanitizeChatText(raw: string | undefined | null, maxLen = 4500): string {
  if (raw == null) return '';
  const limit = Number.isFinite(maxLen) && maxLen > 0 ? Math.min(Math.trunc(maxLen), 4500) : 4500;
  let text = String(raw);
  text = text.replace(/<\/?[^>]+>/g, '');
  text = text.replace(/\b(?:javascript|data|vbscript)\s*:/gi, '');
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return text.trim().slice(0, limit);
}
