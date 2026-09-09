import { money } from '../api/client';
import type { Review } from '../api/contracts';
import { IconStar } from './NavIcons';
import { Button, Card } from '../design-system';
import type { ReactNode } from 'react';

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

export function ReviewCard({
  review,
  author,
  onAppeal,
}: {
  review: Review;
  author: ReactNode;
  onAppeal?: () => void;
}) {
  const title = review.productTitle?.trim() || 'Заказ';
  const amount = review.totalAmountCents;

  return (
    <Card className="review-card">
      <div className="review-card__top">
        <div className="review-card__order">
          <strong className="review-card__title" title={title}>{title}</strong>
          {amount != null && amount !== '' && (
            <span className="review-card__amount">{money(amount)}</span>
          )}
        </div>
        <Stars rating={review.rating} />
      </div>
      <div className="review-card__author">{author}</div>
      {review.text?.trim() ? <p className="review-card__text muted">{review.text}</p> : null}
      {onAppeal && (
        <div className="review-card__actions">
          <Button variant="secondary" onClick={onAppeal}>Обжаловать</Button>
        </div>
      )}
    </Card>
  );
}
