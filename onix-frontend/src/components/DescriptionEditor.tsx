import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

export type DescAlign = 'left' | 'center' | 'right';
export type DescFont = 'body' | 'display' | 'mono' | 'hand' | 'script';

const FONT_NAME: Record<DescFont, string> = {
  body: 'DM Sans',
  display: 'Syne',
  mono: 'JetBrains Mono',
  hand: 'Segoe Print',
  script: 'Segoe Script',
};

const FONT_STACK: Record<DescFont, string> = {
  body: 'var(--font-body), "DM Sans", system-ui, sans-serif',
  display: 'var(--font-display), Syne, system-ui, sans-serif',
  mono: 'var(--font-mono), "JetBrains Mono", ui-monospace, monospace',
  hand: '"Segoe Print", "Comic Sans MS", "Chalkboard SE", cursive',
  script: '"Segoe Script", "Apple Chancery", "Bradley Hand", cursive',
};

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
  probe.innerHTML = html;
  return (probe.textContent || '').length;
}

function runCommand(command: string, value?: string) {
  try {
    document.execCommand(command, false, value);
  } catch {
    /* ignore unsupported command */
  }
}

export function DescriptionEditor({
  value,
  onChange,
  align,
  font,
  onAlignChange,
  onFontChange,
  maxLength = 20000,
  disabled,
  placeholder = 'Подробно опишите товар',
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHtml = useRef(value);
  const [boldOn, setBoldOn] = useState(false);
  const [italicOn, setItalicOn] = useState(false);
  const [underlineOn, setUnderlineOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== lastHtml.current) {
      el.innerHTML = value || '';
      lastHtml.current = value;
    }
  }, [value]);

  const syncFromEditor = () => {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML === '<br>' ? '' : el.innerHTML;
    const len = (el.textContent || '').length;
    if (len > maxLength) {
      // Soft trim: keep previous value if over limit
      el.innerHTML = lastHtml.current || '';
      return;
    }
    lastHtml.current = html;
    onChange(html);
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
    onFontChange(next);
    focusEditor();
    runCommand('fontName', FONT_NAME[next]);
    syncFromEditor();
  };

  const empty = plainLength(value) === 0;

  return (
    <div className={`desc-editor${disabled ? ' is-disabled' : ''}`}>
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
        <label className="desc-editor__font">
          <span className="sr-only">Шрифт</span>
          <select
            value={font}
            disabled={disabled}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => setFont(event.target.value as DescFont)}
            aria-label="Шрифт описания"
          >
            <option value="body">Обычный</option>
            <option value="display">Заголовок</option>
            <option value="mono">Моно</option>
            <option value="hand">Почерк</option>
            <option value="script">Скрипт</option>
          </select>
        </label>
      </div>
      <div
        ref={ref}
        className={`control control--area desc-editor__area desc-editor__area--${align}${empty ? ' is-empty' : ''}`}
        style={{ fontFamily: FONT_STACK[font] }}
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
      />
      <div className="desc-editor__meta">
        <span>{plainLength(value)}/{maxLength}</span>
      </div>
    </div>
  );
}
