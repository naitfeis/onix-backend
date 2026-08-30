import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { money } from '../api/client';
import {
  CATEGORY_LABELS, formatLastSeen, sellerIsPresent, type Product, type TrustCard,
} from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Button, Card } from '../design-system';
import { popModal, pushModal } from '../design-system/modalStack';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
import type { Core } from './types';
import { StaffBadge } from './shared';

const PAYMENT_WARNING =
  'Не подтверждайте заказ до передачи вам товара продавцом и ведите видеозапись, чтобы избежать спорных ситуаций.';

export function LotSheet({
  product,
  detailReady,
  trust,
  core,
  buying,
  onBack,
  onBuy,
  onOpenSeller,
  onWrite,
  onToggleFollow,
}: {
  product: Product;
  detailReady: boolean;
  trust: TrustCard | null;
  core: Core;
  buying: boolean;
  onBack: () => void;
  onBuy: () => void;
  onOpenSeller: () => void;
  onWrite: () => void;
  onToggleFollow: () => void;
}) {
  const [payHint, setPayHint] = useState(true);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const balance = core.profile?.balanceCents ?? '0';
  const lot = product.lotNumber != null ? `ONIXLOT-${product.lotNumber}` : null;
  const canBuy = product.status === 'ACTIVE';
  const present = sellerIsPresent(product.seller, core.profile, core.presenceOf(product.seller.onixId));

  useEffect(() => {
    const { id } = pushModal(() => onBackRef.current());
    document.body.classList.add('lot-sheet-open');
    return () => {
      popModal(id);
      document.body.classList.remove('lot-sheet-open');
    };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="lot-sheet" role="dialog" aria-modal="true" aria-label={product.title}>
      <div className="lot-sheet__bar">
        <Button type="button" variant="secondary" onClick={onBack}>Назад</Button>
        {lot && <span className="onixlot-id">{lot}</span>}
      </div>
      <div className="lot-sheet__body">
        <div className="lot-sheet__hero">
          <h1>{product.title}</h1>
          <strong className="lot-sheet__price">{money(product.priceCents)}</strong>
          {product.warrantyLabel && (
            <span className="lot-sheet__warranty">{product.warrantyLabel}</span>
          )}
          <p className="muted">
            {CATEGORY_LABELS[product.category as keyof typeof CATEGORY_LABELS] ?? product.category}
          </p>
          <p className="muted">
            {!detailReady ? 'Загрузка описания…' : (product.description?.trim() || 'Продавец не добавил описание.')}
          </p>
        </div>
        {trust && (
          <div className="trust-strip">
            <span><b>Уровень {trust.level}</b></span>
            <span><b>{money(trust.depositTotal)}</b> залог</span>
          </div>
        )}
        <Card>
          <div className="seller-row">
            <div className="user-summary">
              <UserAvatar
                userId={product.seller.id}
                avatarUrl={product.seller.avatarUrl}
                name={product.seller.username}
                online={present}
              />
              <div>
                <b>{publicAt(product.seller.username)} <StaffBadge badge={product.seller.badge} /></b>
                <p className="muted">
                  {formatOnixId(product.seller.onixId)} · {product.seller.salesCount} сделок · {product.seller.reviewCount} отзывов · {present ? 'Online' : formatLastSeen(core.presenceOf(product.seller.onixId)?.lastOnline ?? product.seller.lastOnline)}
                </p>
              </div>
            </div>
            <span>★ {product.seller.rating.toFixed(1)}</span>
          </div>
          <div className="card-actions">
            <Button type="button" variant="secondary" onClick={onOpenSeller}>Профиль продавца</Button>
            <Button type="button" variant="secondary" onClick={onWrite}>Написать</Button>
            <Button
              variant="secondary"
              busy={core.actionBusy === `follow-${product.seller.onixId}`}
              onClick={onToggleFollow}
            >{product.seller.followed ? 'Отписаться' : '+ Подписаться'}</Button>
          </div>
        </Card>
      </div>
      <div className="lot-sheet__buy">
        {payHint && <p className="lot-sheet__warn">{PAYMENT_WARNING}</p>}
        <div className="lot-sheet__pay">
          <div>
            <small>Ваш баланс</small>
            <strong>{money(balance)}</strong>
          </div>
          <div>
            <small>К оплате</small>
            <strong>{money(product.priceCents)}</strong>
          </div>
          <Button
            variant="buy"
            busy={buying}
            disabled={!canBuy}
            onClick={() => {
              setPayHint(true);
              onBuy();
            }}
          >Купить</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
