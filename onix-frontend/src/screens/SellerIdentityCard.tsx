import {
  formatLastSeen, sellerIsPresent, type Seller, type TrustCard,
} from '../api/contracts';
import { money } from '../api/client';
import UserAvatar from '../components/UserAvatar';
import { Button, Card } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
import type { Core } from './types';
import { StaffBadge } from './shared';

export function SellerIdentityCard({
  seller,
  trust,
  core,
  compact,
  checkout,
  onOpen,
  onWrite,
  onToggleFollow,
}: {
  seller: Seller;
  trust?: TrustCard | null;
  core: Core;
  compact?: boolean;
  checkout?: boolean;
  onOpen?: () => void;
  onWrite?: () => void;
  onToggleFollow?: () => void;
}) {
  const present = sellerIsPresent(seller, core.profile, core.presenceOf(seller.onixId));
  const showFollow = Boolean(onToggleFollow) && !checkout;

  return (
    <Card className={`profile-card seller-identity${compact ? ' seller-identity--compact' : ''}${checkout ? ' seller-identity--checkout' : ''}`}>
      <UserAvatar
        userId={seller.id}
        avatarUrl={seller.avatarUrl}
        name={seller.username}
        size={compact ? 'small' : 'medium'}
        online={present}
      />
      <div className="profile-main">
        <h1>
          {publicAt(seller.username)} <StaffBadge badge={seller.badge} />
        </h1>
        <p>
          {formatOnixId(seller.onixId)} · {present ? 'Online' : formatLastSeen(core.presenceOf(seller.onixId)?.lastOnline ?? seller.lastOnline)}
        </p>
        <div className="stats">
          <span><b>★ {seller.rating.toFixed(1)}</b> рейтинг</span>
          <span><b>{seller.salesCount}</b> сделок</span>
          <span><b>{seller.reviewCount}</b> отзывов</span>
          <span><b>{seller.followersCount}</b> подписчиков</span>
          {!checkout && trust && <span><b>Уровень {trust.level}</b> доверия</span>}
          {!checkout && trust && <span><b>{money(trust.depositTotal)}</b> залог</span>}
        </div>
        {checkout && (
          <div className="seller-identity__trust">
            <p><span>Уровень доверия</span><b>{trust ? `Уровень ${trust.level}` : '—'}</b></p>
            <p><span>Размер залога</span><b>{trust ? money(trust.depositTotal) : '—'}</b></p>
          </div>
        )}
      </div>
      {(onOpen || onWrite || showFollow) && (
        <div className={`card-actions${checkout ? ' seller-identity__actions' : ''}`}>
          {onWrite && (
            <Button type="button" variant={checkout ? 'violet' : 'secondary'} onClick={onWrite}>
              Написать
            </Button>
          )}
          {onOpen && (
            <Button type="button" variant={checkout ? 'violet' : 'secondary'} onClick={onOpen}>
              Профиль
            </Button>
          )}
          {showFollow && (
            <Button
              variant="secondary"
              busy={core.actionBusy === `follow-${seller.onixId}`}
              onClick={onToggleFollow}
            >{seller.followed ? 'Отписаться' : 'Подписаться'}</Button>
          )}
        </div>
      )}
    </Card>
  );
}
