import { money } from '../api/client';
import type { Review } from '../api/contracts';
import { IconStar } from './NavIcons';
import UserAvatar from './UserAvatar';
import { Card } from '../design-system';
import { publicAt } from '../utils/publicAt';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

function Stars({ rating }: { rating: number }) {
  const value = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="review-card__stars" aria-label={`${value} из 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < value ? 'is-on' : 'is-off'} aria-hidden="true">
          <IconStar size={13} />
        </span>
      ))}
    </span>
  );
}

function formatReviewWhen(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReviewCard({
  review,
  authorBadge,
  onOpenAuthor,
  ownerMenu,
}: {
  review: Review;
  authorBadge?: ReactNode;
  onOpenAuthor?: (onixId: string) => void;
  /** Own-profile only: ⋯ menu with report / reply actions. */
  ownerMenu?: {
    onReport: () => void;
    onReply: () => void;
  };
}) {
  const title = review.productTitle?.trim() || 'Заказ';
  const amount = review.totalAmountCents;
  const when = formatReviewWhen(review.createdAt);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const authorName = publicAt(review.author.username);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const openAuthor = () => {
    if (review.author.onixId && onOpenAuthor) onOpenAuthor(review.author.onixId);
  };

  return (
    <Card className="review-card">
      <div className="review-card__top">
        <div className="review-card__order">
          <strong className="review-card__title" title={title}>{title}</strong>
          {amount != null && amount !== '' && (
            <span className="review-card__amount">{money(amount)}</span>
          )}
        </div>
        <div className="review-card__top-right">
          <Stars rating={review.rating} />
          {ownerMenu && (
            <div className="review-card__menu" ref={menuRef}>
              <button
                type="button"
                className="review-card__menu-btn"
                aria-label="Действия с отзывом"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls={menuId}
                onClick={() => setMenuOpen((open) => !open)}
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="review-card__menu-panel" role="menu" id={menuId}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      ownerMenu.onReport();
                    }}
                  >
                    Пожаловаться
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      ownerMenu.onReply();
                    }}
                  >
                    Ответить на отзыв
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="review-card__author">
        <UserAvatar
          userId={review.author.id}
          avatarUrl={review.author.avatarUrl}
          name={review.author.username}
          size="small"
          onClick={review.author.onixId && onOpenAuthor ? openAuthor : undefined}
        />
        <div className="review-card__author-meta">
          {review.author.onixId && onOpenAuthor ? (
            <button type="button" className="linkish review-card__author-name" onClick={openAuthor}>
              <b>{authorName}</b> {authorBadge}
            </button>
          ) : (
            <span className="review-card__author-name"><b>{authorName}</b> {authorBadge}</span>
          )}
          {when ? <small className="review-card__when">{when}</small> : null}
        </div>
      </div>

      {review.text?.trim() ? <p className="review-card__text muted">{review.text}</p> : null}
    </Card>
  );
}
