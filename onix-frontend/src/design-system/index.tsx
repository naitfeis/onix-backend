import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { popModal, pushModal } from './modalStack';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg className="icon" width={size} height={size} aria-hidden="true"><use href={`/icons.svg#${name}`} /></svg>;
}

export function Button({ variant = 'primary', busy, children, className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
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

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={['control', className].filter(Boolean).join(' ')} {...props} />;
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

export function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [zIndex, setZIndex] = useState(2000);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`).current;

  useEffect(() => {
    if (!open) return;
    const { id, depth } = pushModal(() => onCloseRef.current());
    setZIndex(2100 + depth * 10);
    return () => popModal(id);
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
        className="modal__panel"
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
