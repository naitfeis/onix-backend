import { useRef, type TextareaHTMLAttributes } from 'react';

export type DescAlign = 'left' | 'center' | 'right';
export type DescFont = 'body' | 'display' | 'mono' | 'hand' | 'script';

const FONT_STACK: Record<DescFont, string> = {
  body: 'var(--font-body), system-ui, sans-serif',
  display: 'var(--font-display), system-ui, sans-serif',
  mono: 'var(--font-mono), ui-monospace, monospace',
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

function wrapSelection(
  el: HTMLTextAreaElement,
  before: string,
  after: string,
  onChange: (value: string) => void,
) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = el.value.slice(start, end) || 'текст';
  const next = `${el.value.slice(0, start)}${before}${selected}${after}${el.value.slice(end)}`;
  onChange(next);
  requestAnimationFrame(() => {
    el.focus();
    const caret = start + before.length + selected.length + after.length;
    el.setSelectionRange(caret, caret);
  });
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
  placeholder,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const run = (before: string, after: string) => {
    const el = ref.current;
    if (!el || disabled) return;
    wrapSelection(el, before, after, onChange);
  };

  return (
    <div className="desc-editor">
      <div className="desc-editor__toolbar" role="toolbar" aria-label="Форматирование описания">
        <button type="button" className="desc-editor__btn" disabled={disabled} onClick={() => run('**', '**')} title="Жирный">B</button>
        <button type="button" className="desc-editor__btn desc-editor__btn--italic" disabled={disabled} onClick={() => run('*', '*')} title="Курсив">I</button>
        <button type="button" className="desc-editor__btn" disabled={disabled} onClick={() => run('__', '__')} title="Подчёркнутый">U</button>
        <span className="desc-editor__sep" aria-hidden="true" />
        <button
          type="button"
          className={`desc-editor__btn${align === 'left' ? ' is-active' : ''}`}
          disabled={disabled}
          onClick={() => onAlignChange('left')}
          title="По левому краю"
          aria-pressed={align === 'left'}
        >⫷</button>
        <button
          type="button"
          className={`desc-editor__btn${align === 'center' ? ' is-active' : ''}`}
          disabled={disabled}
          onClick={() => onAlignChange('center')}
          title="По центру"
          aria-pressed={align === 'center'}
        >☰</button>
        <button
          type="button"
          className={`desc-editor__btn${align === 'right' ? ' is-active' : ''}`}
          disabled={disabled}
          onClick={() => onAlignChange('right')}
          title="По правому краю"
          aria-pressed={align === 'right'}
        >⫸</button>
        <span className="desc-editor__sep" aria-hidden="true" />
        <label className="desc-editor__font">
          <span className="sr-only">Шрифт</span>
          <select
            value={font}
            disabled={disabled}
            onChange={(event) => onFontChange(event.target.value as DescFont)}
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
      <textarea
        ref={ref}
        className={`control control--area desc-editor__area desc-editor__area--${align}`}
        style={{ fontFamily: FONT_STACK[font] }}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="desc-editor__meta">
        <span>{value.length}/{maxLength}</span>
      </div>
    </div>
  );
}

export function descriptionStyleAttrs(
  align: DescAlign,
  font: DescFont,
): TextareaHTMLAttributes<HTMLTextAreaElement>['style'] {
  return {
    fontFamily: FONT_STACK[font],
    textAlign: align,
  };
}
