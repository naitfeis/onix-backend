import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type TouchEvent as ReactTouchEvent,
} from 'react';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg className="icon" width={size} height={size} aria-hidden="true"><use href={`/icons.svg#${name}`} /></svg>;
}

export function Button({ variant = 'primary', busy, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  busy?: boolean;
}) {
  return <button className={`button button--${variant} ${className}`} disabled={busy || props.disabled} {...props}>
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

let openModalCount = 0;

function syncModalBodyClass() {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('modal-open', openModalCount > 0);
}

type TelegramBackButton = {
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
};

function telegramBackButton(): TelegramBackButton | null {
  try {
    const wa = (window as unknown as { Telegram?: { WebApp?: { BackButton?: TelegramBackButton } } }).Telegram?.WebApp;
    return wa?.BackButton ?? null;
  } catch {
    return null;
  }
}

export function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    openModalCount += 1;
    syncModalBodyClass();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    const back = telegramBackButton();
    const onBack = () => onCloseRef.current();
    if (back) {
      back.show();
      back.onClick(onBack);
    }
    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      syncModalBodyClass();
      if (openModalCount === 0) document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      if (back) {
        back.offClick(onBack);
        if (openModalCount === 0) back.hide();
      }
    };
  }, [open]);

  if (!open) return null;
  const closeFromBackdrop = (event: ReactMouseEvent | ReactTouchEvent) => {
    if (event.target === event.currentTarget) onClose();
  };
  return <div
    className="modal"
    role="presentation"
    onMouseDown={closeFromBackdrop}
    onClick={closeFromBackdrop}
  >
    <div
      className="modal__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onMouseDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div className="modal__head">
        <h2 id="modal-title">{title}</h2>
        <Button type="button" variant="ghost" onClick={onClose} aria-label="Закрыть">×</Button>
      </div>
      {children}
    </div>
  </div>;
}

export function Confirm({ open, title, text, dangerous, busy, onCancel, onConfirm }: {
  open: boolean; title: string; text: string; dangerous?: boolean; busy?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return <Modal open={open} title={title} onClose={onCancel}><p className="modal__text">{text}</p><div className="modal__actions">
    <Button variant="secondary" onClick={onCancel}>Отмена</Button>
    <Button variant={dangerous ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>Подтвердить</Button>
  </div></Modal>;
}

export function Toast({ message, tone = 'success' }: { message: string; tone?: 'success' | 'danger' }) {
  return <div className={`toast toast--${tone}`} role="status">{message}</div>;
}
