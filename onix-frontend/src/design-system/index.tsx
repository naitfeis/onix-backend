import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

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

export function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  if (!open) return null;
  return <div className="modal" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="modal__panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal__head"><h2 id="modal-title">{title}</h2><Button variant="ghost" onClick={onClose} aria-label="Закрыть">×</Button></div>
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
