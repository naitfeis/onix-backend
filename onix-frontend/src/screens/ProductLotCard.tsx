import { memo, type ReactNode } from 'react';
import { money } from '../api/client';
import type { Product } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { MoreActionsMenu } from '../components/MoreActionsMenu';
import { IconStar } from '../components/NavIcons';
import { Card } from '../design-system';
import { publicAt } from '../utils/publicAt';
import { categoryLabel, t } from '../i18n';

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

export const ProductLotCard = memo(function ProductLotCard({
  product,
  online,
  onOpen,
  onFavorite,
  onBlock,
  onReport,
  hidePrice,
  footer,
}: {
  product: Product;
  online?: boolean;
  onOpen: () => void;
  onFavorite?: () => void;
  onBlock?: () => void;
  onReport?: () => void;
  hidePrice?: boolean;
  footer?: ReactNode;
}) {
  const rating = product.seller.rating.toFixed(1);
  const showFounder = product.seller.badge === 'SUPER_ADMIN';
  const title = product.title.length > 36 ? `${product.title.slice(0, 36)}…` : product.title;
  const menuItems = [
    onFavorite
      ? {
          id: 'favorite',
          label: product.favorite ? t('market.favoriteRemove') : t('market.favoriteAdd'),
          onSelect: onFavorite,
        }
      : null,
    onBlock
      ? {
          id: 'block',
          label: t('social.block'),
          onSelect: onBlock,
        }
      : null,
    onReport
      ? {
          id: 'report',
          label: 'Пожаловаться',
          danger: true,
          onSelect: onReport,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

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
          {showFounder && (
            <div className="product-card__flags product-card__flags--media">
              <span className="pill-super">Основатель</span>
            </div>
          )}
        </div>
        {product.autoDeliver && (
          <span className="product-card__bolt" title="Автовыдача" aria-label="Автовыдача">⚡</span>
        )}
        <div className="product-card__seller-float">
          <div className="product-card__avatar">
            <UserAvatar
              userId={product.seller.id}
              avatarUrl={product.seller.avatarUrl}
              name={product.seller.username}
              size="medium"
              online={online}
            />
          </div>
          <span title={product.seller.username}>{publicAt(product.seller.username)}</span>
        </div>
        {menuItems.length > 0 && (
          <MoreActionsMenu className="product-card__menu" items={menuItems} />
        )}
      </div>
      <button type="button" className="product-main product-main--body" onClick={onOpen} aria-label={`Открыть ${product.title}`}>
        <div className="product-card__body">
          {showFounder && (
            <span className="pill-super product-card__founder-inline">Основатель</span>
          )}
          <h2>{title}</h2>
          <p className="product-card__meta">
            {categoryLabel(product.category)}
            {lotLabel(product) ? ` · ${lotLabel(product)}` : ''}
          </p>
        </div>
      </button>
      {footer ?? (
        <div className="product-card__footer product-card__footer--bar product-card__footer--price-only">
          {!hidePrice && <strong className="product-card__price">{money(product.priceCents)}</strong>}
        </div>
      )}
    </Card>
  );
});

export default ProductLotCard;
