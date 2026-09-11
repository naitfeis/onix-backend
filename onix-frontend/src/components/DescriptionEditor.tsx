import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { sanitizeDescriptionHtml, stripToSafeRichHtml } from '../utils/formattedDescription';

export type DescAlign = 'left' | 'center' | 'right';
export type DescFont = 'body' | 'display' | 'mono' | 'hand';

const FONT_OPTIONS: { id: DescFont; label: string; face: string; stack: string }[] = [
  { id: 'body', label: 'Обычный', face: 'DM Sans', stack: 'var(--font-body), "DM Sans", system-ui, sans-serif' },
  { id: 'display', label: 'Заголовок', face: 'Syne', stack: 'var(--font-display), Syne, system-ui, sans-serif' },
  { id: 'mono', label: 'Mono', face: 'JetBrains Mono', stack: 'var(--font-mono), "JetBrains Mono", ui-monospace, monospace' },
  { id: 'hand', label: 'Почерк', face: 'Segoe Print', stack: '"Segoe Print", "Comic Sans MS", "Chalkboard SE", cursive' },
];

const DESC_MAX = 500;

type Props = {
  value: string;
  onChange: (value: string) => void;
  align: DescAlign;
  font: DescFont;
  onAlignChange: (align: DescAlign) => void;
  onFontChange: (font: DescFont) => void;
  maxLength?: number;
  disabled?: boolean;
  placeholder?: string;
};

function plainLength(html: string): number {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, '').length;
  }
  const probe = document.createElement('div');
  probe.innerHTML = sanitizeDescriptionHtml(html);
  return (probe.textContent || '').replace(/\u00a0/g, ' ').length;
}

function runCommand(command: string, value?: string) {
  try {
    document.execCommand(command, false, value);
  } catch {
    /* ignore */
  }
}

export function DescriptionEditor({
  value,
  onChange,
  align,
  font,
  onAlignChange,
  onFontChange,
  maxLength = DESC_MAX,
  disabled,
  placeholder = 'Подробно опишите товар',
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastHtml = useRef(value);
  const [fontOpen, setFontOpen] = useState(false);
  const [boldOn, setBoldOn] = useState(false);
  const [italicOn, setItalicOn] = useState(false);
  const [underlineOn, setUnderlineOn] = useState(false);
  const activeFont = FONT_OPTIONS.find((item) => item.id === font) ?? FONT_OPTIONS[0];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== lastHtml.current) {
      el.innerHTML = sanitizeDescriptionHtml(value || '');
      lastHtml.current = value;
    }
  }, [value]);

  useEffect(() => {
    if (!fontOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setFontOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [fontOpen]);

  const syncFromEditor = () => {
    const el = ref.current;
    if (!el) return;
    const safe = stripToSafeRichHtml(el.innerHTML === '<br>' ? '' : el.innerHTML);
    const len = plainLength(safe);
    if (len > maxLength) {
      el.innerHTML = sanitizeDescriptionHtml(lastHtml.current || '');
      return;
    }
    if (el.innerHTML !== safe) el.innerHTML = safe;
    lastHtml.current = safe;
    onChange(safe);
  };

  const refreshCommandState = () => {
    try {
      setBoldOn(document.queryCommandState('bold'));
      setItalicOn(document.queryCommandState('italic'));
      setUnderlineOn(document.queryCommandState('underline'));
    } catch {
      /* ignore */
    }
  };

  const focusEditor = () => {
    const el = ref.current;
    if (!el || disabled) return;
    el.focus();
  };

  const apply = (event: ReactMouseEvent, action: () => void) => {
    event.preventDefault();
    focusEditor();
    action();
    syncFromEditor();
    refreshCommandState();
  };

  const setAlign = (next: DescAlign) => {
    onAlignChange(next);
    focusEditor();
    if (next === 'left') runCommand('justifyLeft');
    if (next === 'center') runCommand('justifyCenter');
    if (next === 'right') runCommand('justifyRight');
    syncFromEditor();
  };

  const setFont = (next: DescFont) => {
    const option = FONT_OPTIONS.find((item) => item.id === next) ?? FONT_OPTIONS[0];
    onFontChange(option.id);
    setFontOpen(false);
    focusEditor();
    runCommand('fontName', option.face);
    syncFromEditor();
  };

  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const plain = event.clipboardData.getData('text/plain') || '';
    const clipped = plain.slice(0, Math.max(0, maxLength - plainLength(lastHtml.current || '')));
    runCommand('insertText', clipped);
    syncFromEditor();
  };

  const empty = plainLength(value) === 0;

  return (
    <div ref={rootRef} className={`desc-editor${disabled ? ' is-disabled' : ''}`}>
      <div className="desc-editor__toolbar" role="toolbar" aria-label="Форматирование описания">
        <button
          type="button"
          className={`desc-editor__btn${boldOn ? ' is-active' : ''}`}
          disabled={disabled}
          onMouseDown={(event) => apply(event, () => runCommand('bold'))}
          title="Жирный"
          aria-pressed={boldOn}
        >B</button>
        <button
          type="button"
          className={`desc-editor__btn desc-editor__btn--italic${italicOn ? ' is-active' : ''}`}
          disabled={disabled}
          onMouseDown={(event) => apply(event, () => runCommand('italic'))}
          title="Курсив"
          aria-pressed={italicOn}
        >I</button>
        <button
          type="button"
          className={`desc-editor__btn${underlineOn ? ' is-active' : ''}`}
          disabled={disabled}
          onMouseDown={(event) => apply(event, () => runCommand('underline'))}
          title="Подчёркнутый"
          aria-pressed={underlineOn}
        >U</button>
        <span className="desc-editor__sep" aria-hidden="true" />
        <button
          type="button"
          className={`desc-editor__btn${align === 'left' ? ' is-active' : ''}`}
          disabled={disabled}
          onMouseDown={(event) => { event.preventDefault(); setAlign('left'); }}
          title="По левому краю"
          aria-pressed={align === 'left'}
        >⫷</button>
        <button
          type="button"
          className={`desc-editor__btn${align === 'center' ? ' is-active' : ''}`}
          disabled={disabled}
          onMouseDown={(event) => { event.preventDefault(); setAlign('center'); }}
          title="По центру"
          aria-pressed={align === 'center'}
        >☰</button>
        <button
          type="button"
          className={`desc-editor__btn${align === 'right' ? ' is-active' : ''}`}
          disabled={disabled}
          onMouseDown={(event) => { event.preventDefault(); setAlign('right'); }}
          title="По правому краю"
          aria-pressed={align === 'right'}
        >⫸</button>
        <span className="desc-editor__sep" aria-hidden="true" />
        <div className="desc-editor__font-menu">
          <button
            type="button"
            className={`desc-editor__font-trigger${fontOpen ? ' is-open' : ''}`}
            disabled={disabled}
            aria-expanded={fontOpen}
            aria-haspopup="listbox"
            onMouseDown={(event) => {
              event.preventDefault();
              setFontOpen((open) => !open);
            }}
          >
            <span>{activeFont.label}</span>
          </button>
          {fontOpen && (
            <div className="desc-editor__font-list" role="listbox" aria-label="Шрифт описания">
              {FONT_OPTIONS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  role="option"
                  aria-selected={item.id === font}
                  className={item.id === font ? 'is-active' : undefined}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setFont(item.id);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        ref={ref}
        className={`control control--area desc-editor__area desc-editor__area--${align}${empty ? ' is-empty' : ''}`}
        style={{ fontFamily: activeFont.stack }}
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label="Описание товара"
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={syncFromEditor}
        onKeyUp={refreshCommandState}
        onMouseUp={refreshCommandState}
        onBlur={syncFromEditor}
        onPaste={onPaste}
      />
      <div className="desc-editor__meta">
        <span>{plainLength(value)}/{maxLength}</span>
      </div>
    </div>
  );
}

export const DESCRIPTION_MAX_CHARS = DESC_MAX;
