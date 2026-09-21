import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { modalStackSize, popModal, pushModal } from './modalStack';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg className="icon" width={size} height={size} aria-hidden="true"><use href={`/icons.svg#${name}`} /></svg>;
}

export function Button({ variant = 'primary', busy, children, className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'buy' | 'violet';
  busy?: boolean;
}) {
  return <button type={type} className={`button button--${variant} ${className}`} disabled={busy || props.disabled} {...props}>
    {busy && <span className="spinner" aria-hidden="true" />}
    {children}
  </button>;
}

export function Card({ interactive, className = '', ...props }: HTMLAttributes<HTMLElement> & { interactive?: boolean }) {
  return <section className={`card ${interactive ? 'card--interactive' : ''} ${className}`} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field__label">{label}</span>{children}{hint && <span className="field__hint">{hint}</span>}</label>;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="control" {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="control control--area" {...props} />;
}

type SelectOption = { value: string; label: string; disabled?: boolean };

function readSelectOptions(children: ReactNode): SelectOption[] {
  const list: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
    if (el.type !== 'option') return;
    list.push({
      value: String(el.props.value ?? ''),
      label: String(el.props.children ?? ''),
      disabled: Boolean(el.props.disabled),
    });
  });
  return list;
}

/** Custom listbox — avoids Windows native <select> white popup with invisible (white-on-white) options. */
export function Select({
  className = '',
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  id,
  name,
  'aria-label': ariaLabel,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = useMemo(() => readSelectOptions(children), [children]);
  const isControlled = value !== undefined;
  const [uncontrolled, setUncontrolled] = useState(String(defaultValue ?? options[0]?.value ?? ''));
  const current = String(isControlled ? value : uncontrolled);
  const selected = options.find((o) => o.value === current) ?? options[0];
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commit = (next: string) => {
    if (!isControlled) setUncontrolled(next);
    onChange?.({
      target: { value: next, name: name ?? '', type: 'select-one' },
      currentTarget: { value: next, name: name ?? '', type: 'select-one' },
    } as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={['select-menu', open ? 'is-open' : '', className].filter(Boolean).join(' ')}
      data-disabled={disabled ? 'true' : undefined}
    >
      <button
        type="button"
        id={id}
        className="control select-menu__trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
      >
        <span className="select-menu__value">{selected?.label ?? ''}</span>
      </button>
      {open && (
        <ul id={listId} className="select-menu__list" role="listbox" aria-label={ariaLabel}>
          {options.map((opt) => (
            <li key={opt.value} role="presentation">
              <button
                type="button"
                role="option"
                className={`select-menu__option${opt.value === current ? ' is-active' : ''}`}
                aria-selected={opt.value === current}
                disabled={opt.disabled}
                onClick={() => commit(opt.value)}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton" aria-label="Загрузка">{Array.from({ length: lines }, (_, index) =>
    <span key={index} style={{ width: `${100 - (index % 3) * 14}%` }} />)}</div>;
}

export function StateView({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <Card className="state" role="status"><div className="state__mark" aria-hidden="true">◇</div><h3>{title}</h3><p>{text}</p>{action}</Card>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Modal({ open, title, children, onClose, size = 'default' }: {
  open: boolean; title: string; children: ReactNode; onClose: () => void; size?: 'default' | 'wide';
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Stack modals via --z-modal + depth (no magic 2100).
  const [zIndex, setZIndex] = useState(() => {
    const base = Number.parseInt(
      typeof getComputedStyle !== 'undefined'
        ? getComputedStyle(document.documentElement).getPropertyValue('--z-modal').trim()
        : '1100',
      10,
    ) || 1100;
    return base + modalStackSize() * 10;
  });
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`).current;

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement;
    const { id, depth } = pushModal(() => onCloseRef.current());
    const base = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--z-modal').trim(),
      10,
    ) || 1100;
    setZIndex(base + depth * 10);
    return () => { popModal(id); restoreFocusRef.current?.focus(); restoreFocusRef.current = null; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const closeFromBackdrop = (event: ReactMouseEvent | ReactTouchEvent) => {
    if (event.target === event.currentTarget) onClose();
  };

  // Portal to body: ancestors with transform/perspective break position:fixed
  // (tab slide animation), so modals were stuck to page scroll top instead of viewport center.
  return createPortal(
    <div
      className="modal"
      role="presentation"
      style={{ zIndex }}
      onMouseDown={closeFromBackdrop}
      onClick={closeFromBackdrop}
    >
      <div
        className={`modal__panel${size === 'wide' ? ' modal__panel--wide' : ''}`}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
      >
        <div className="modal__head">
          <h2 id={titleId}>{title}</h2>
          <Button
            type="button"
            variant="ghost"
            className="modal__close"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }}
            aria-label="Закрыть"
          >×</Button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ open, title, text, dangerous, busy, onCancel, onConfirm }: {
  open: boolean; title: string; text: string; dangerous?: boolean; busy?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return <Modal open={open} title={title} onClose={onCancel}><p className="modal__text">{text}</p><div className="modal__actions">
    <Button type="button" variant="secondary" onClick={onCancel}>Отмена</Button>
    <Button type="button" variant={dangerous ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>Подтвердить</Button>
  </div></Modal>;
}

export function Toast({ message, tone = 'success' }: { message: string; tone?: 'success' | 'danger' }) {
  return <div className={`toast toast--${tone}`} role="status">{message}</div>;
}
