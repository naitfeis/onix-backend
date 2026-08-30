import { type ReactNode } from 'react';
import { money } from '../api/client';
import { CATEGORY_LABELS, sellerIsPresent, type Product } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { IconStar } from '../components/NavIcons';
import { Card } from '../design-system';
import { publicAt } from '../utils/publicAt';
import { t } from '../i18n';
import type { Core } from './types';

function reviewCountLabel(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return `${n} отзывов`;
  if (last === 1) return `${n} отзыв`;
  if (last >= 2 && last <= 4) return `${n} отзыва`;
  return `${n} отзывов`;
}

function lotLabel(product: Product) {
  return product.lotNumber != null ? `ONIXLOT-${product.lotNumber}` : null;
}

export function ProductLotCard({
  product,
  core,
  onOpen,
  onFavorite,
  hidePrice,
  footer,
}: {
  product: Product;
  core: Core;
  onOpen: () => void;
  onFavorite?: () => void;
  hidePrice?: boolean;
  footer?: ReactNode;
}) {
  const rating = product.seller.rating.toFixed(1);
  const showFounder = product.seller.badge === 'SUPER_ADMIN';
  const title = product.title.length > 36 ? `${product.title.slice(0, 36)}…` : product.title;
  return (
    <Card interactive className="product-card product-card--compact">
      <div className="product-card__media">
        <button
          type="button"
          className="product-card__media-hit"
          onClick={onOpen}
          aria-label={`Открыть ${product.title}`}
        />
        <div className="product-card__badges">
          <div className="product-card__rating">
            <span className="product-card__rating-score"><IconStar /> {rating}</span>
            <span className="product-card__rating-count">{reviewCountLabel(product.seller.reviewCount)}</span>
          </div>
          {showFounder && <span className="pill-super">Основатель</span>}
        </div>
        <div className="product-card__seller-float">
          <div className="product-card__avatar">
            <UserAvatar
              userId={product.seller.id}
              avatarUrl={product.seller.avatarUrl}
              name={product.seller.username}
              size="medium"
              online={sellerIsPresent(product.seller, core.profile, core.presenceOf(product.seller.onixId))}
            />
          </div>
          <span title={product.seller.username}>{publicAt(product.seller.username)}</span>
        </div>
        {onFavorite && (
          <button
            type="button"
            className={`favorite ${product.favorite ? 'active' : ''}`}
            onClick={onFavorite}
            aria-label={product.favorite ? t('market.favoriteRemove') : t('market.favoriteAdd')}
          >♥</button>
        )}
      </div>
      <button type="button" className="product-main product-main--body" onClick={onOpen} aria-label={`Открыть ${product.title}`}>
        <div className="product-card__body">
          <h2>{title}</h2>
          <p className="product-card__meta">
            {CATEGORY_LABELS[product.category as keyof typeof CATEGORY_LABELS] ?? product.category}
            {lotLabel(product) ? ` · ${lotLabel(product)}` : ''}
          </p>
        </div>
      </button>
      {footer ?? (
        <div className="product-card__footer product-card__footer--bar">
          <span className="product-card__warranty">{product.warrantyLabel ?? 'Гарантия: 10 часов'}</span>
          {!hidePrice && <strong className="product-card__price">{money(product.priceCents)}</strong>}
          <button type="button" className="button button--buy product-card__buy" onClick={onOpen}>{t('market.buy')}</button>
        </div>
      )}
    </Card>
  );
}
