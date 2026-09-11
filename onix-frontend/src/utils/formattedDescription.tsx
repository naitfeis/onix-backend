import type { ReactNode } from 'react';

const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'SPAN',
]);

const BLOCKED_TAGS = new Set([
  'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM',
  'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'VIDEO', 'AUDIO',
  'SOURCE', 'TRACK', 'FRAME', 'FRAMESET', 'APPLET', 'STYLE', 'TEMPLATE',
  'NOSCRIPT',
]);

function isSafeStyle(declaration: string): boolean {
  return /^(text-align|font-family|font-weight|font-style|text-decoration)\s*:/i.test(declaration.trim())
    && !/expression|url\s*\(|javascript:|@import/i.test(declaration);
}

function cleanElement(el: HTMLElement) {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on') || name === 'src' || name === 'href' || name === 'xlink:href' || name === 'action' || name === 'formaction') {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === 'style') {
      const safe = attr.value
        .split(';')
        .map((part) => part.trim())
        .filter(isSafeStyle)
        .join('; ');
      if (safe) el.setAttribute('style', safe);
      else el.removeAttribute('style');
      continue;
    }
    el.removeAttribute(attr.name);
  }
}

function sanitizeNode(node: Node, parent: Node) {
  if (node.nodeType === Node.COMMENT_NODE) {
    parent.removeChild(node);
    return;
  }
  if (node.nodeType === Node.TEXT_NODE) return;
  if (node.nodeType !== Node.ELEMENT_NODE) {
    parent.removeChild(node);
    return;
  }
  const el = node as HTMLElement;
  if (BLOCKED_TAGS.has(el.tagName)) {
    parent.removeChild(el);
    return;
  }
  // Process children first (snapshot).
  for (const child of Array.from(el.childNodes)) {
    sanitizeNode(child, el);
  }
  if (!ALLOWED_TAGS.has(el.tagName)) {
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    return;
  }
  cleanElement(el);
}

/** Strip scripts and unsafe HTML from listing descriptions. */
export function sanitizeDescriptionHtml(html: string): string {
  if (!html) return '';
  if (typeof document === 'undefined') {
    return html
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<\/?(?:script|iframe|object|embed|link|meta|base|form|svg|math|style|template|noscript)\b[^>]*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
      .replace(/\s(href|src|xlink:href)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '');
  }
  const root = document.createElement('div');
  root.innerHTML = html;
  for (const child of Array.from(root.childNodes)) {
    sanitizeNode(child, root);
  }
  return root.innerHTML;
}

/** Normalize editor HTML before save/display. */
export function stripToSafeRichHtml(html: string): string {
  const cleaned = sanitizeDescriptionHtml(html)
    .replace(/^(<br\s*\/?>|\s|&nbsp;)+$/i, '')
    .replace(/^<div><br><\/div>$/i, '');
  return cleaned === '<br>' ? '' : cleaned;
}

/** Minimal **bold** / *italic* / __underline__ renderer for plain-text leftovers. */
export function renderInlineMarkup(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('__') && token.endsWith('__')) {
      nodes.push(<u key={key++}>{token.slice(2, -2)}</u>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function FormattedDescription({ text }: { text: string }) {
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(text);
  if (looksHtml) {
    return (
      <span
        className="lot-sheet__rich"
        dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml(text) }}
      />
    );
  }
  const lines = text.split(/\n/);
  return (
    <>
      {lines.map((line, index) => (
        <span key={index}>
          {renderInlineMarkup(line)}
          {index < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  );
}
