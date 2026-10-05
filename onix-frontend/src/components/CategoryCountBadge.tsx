import type { CSSProperties } from 'react';

/** Shared category count badge: number, dim track and proportional filled arc. */
export function categoryCountBadgeState(count: number, total: number) {
  const shown = count > 99 ? '99+' : String(count);
  const fraction = total > 0 ? Math.min(1, Math.max(0, count / total)) : 0;
  const degrees = fraction >= 0.999 ? 360 : fraction > 0 ? Math.max(14, fraction * 360) : 0;
  const label = total > 0 ? `${count} из ${total} лотов` : `${count} лотов`;
  return { shown, fraction, degrees, label, isFull: fraction >= 0.999 };
}

export default function CategoryCountBadge({
  count,
  total,
  variant = 'grid',
  className,
}: {
  count: number;
  total: number;
  /** `grid` keeps the original 24px card badge, `sidebar` renders the compact 22px sidebar badge. */
  variant?: 'grid' | 'sidebar';
  className?: string;
}) {
  const { shown, degrees, label, isFull } = categoryCountBadgeState(count, total);
  const classes = [
    'cat-card__share',
    variant === 'sidebar' ? 'cat-card__share--sidebar' : '',
    isFull && variant === 'sidebar' ? 'cat-card__share--sidebar--full' : '',
    isFull && variant === 'grid' ? 'cat-card__share--full' : '',
    className ?? '',
  ].filter(Boolean).join(' ');
  return (
    <span
      className={classes}
      role="img"
      title={label}
      aria-label={label}
      style={{ '--share-deg': `${degrees}deg` } as CSSProperties}
    >
      <span className="cat-card__share-num">{shown}</span>
    </span>
  );
}
