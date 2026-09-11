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

const DESC_ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'div', 'p', 'span']);
const DESC_PLAIN_MAX = 500;

/**
 * Product description may keep simple formatting tags, never scripts / handlers / URLs.
 * Plain-text length is capped at 500 characters.
 */
export function sanitizeProductDescription(raw: string | undefined | null, maxPlain = DESC_PLAIN_MAX): string {
  if (raw == null) return '';
  let html = String(raw);
  html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<\/?(?:script|iframe|object|embed|link|meta|base|form|svg|math|style|template|noscript|input|button|textarea|select|video|audio|source|track|frame|frameset|applet)\b[^>]*>/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  html = html.replace(/\s(?:href|src|xlink:href|action|formaction)\s*=\s*(['"]).*?\1/gi, '');
  html = html.replace(/\b(?:javascript|data|vbscript)\s*:/gi, '');
  html = html.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  // Drop any remaining tags that are not in the allowlist (keep inner text).
  html = html.replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (full, tag: string) => {
    const name = tag.toLowerCase();
    if (!DESC_ALLOWED.has(name)) return '';
    if (name === 'br') return '<br>';
    if (full.startsWith('</')) return `</${name}>`;
    return `<${name}>`;
  });
  const plain = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ');
  if (plain.length <= maxPlain) return html.trim();
  // Truncate by plain characters while keeping a rough HTML prefix.
  let kept = 0;
  let out = '';
  const parts = html.split(/(<[^>]+>)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('<')) {
      out += part;
      continue;
    }
    const room = maxPlain - kept;
    if (room <= 0) break;
    const slice = part.slice(0, room);
    out += slice;
    kept += slice.length;
  }
  return out.trim();
}
