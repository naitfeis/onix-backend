import type { ReactNode } from 'react';

const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'SPAN', 'FONT',
]);

/** Strip unsafe tags/attrs; keep basic rich-text from the listing editor. */
export function sanitizeDescriptionHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<(?!\/?(?:b|strong|i|em|u|br|div|p|span|font)\b)[^>]*>/gi, '');
  }
  const root = document.createElement('div');
  root.innerHTML = html;
  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          const text = document.createTextNode(el.textContent || '');
          el.replaceWith(text);
          continue;
        }
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          if (name === 'style') {
            const safe = attr.value
              .split(';')
              .map((part) => part.trim())
              .filter((part) => /^(text-align|font-family|font-weight|font-style|text-decoration)\s*:/i.test(part))
              .join('; ');
            if (safe) el.setAttribute('style', safe);
            else el.removeAttribute('style');
          } else if (name === 'face' && el.tagName === 'FONT') {
            /* keep */
          } else {
            el.removeAttribute(attr.name);
          }
        }
        walk(el);
      }
    }
  };
  walk(root);
  return root.innerHTML;
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
