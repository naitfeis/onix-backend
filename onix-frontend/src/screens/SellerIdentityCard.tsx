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
  onOpen,
  onWrite,
  onToggleFollow,
}: {
  seller: Seller;
  trust?: TrustCard | null;
  core: Core;
  compact?: boolean;
  onOpen?: () => void;
  onWrite?: () => void;
  onToggleFollow?: () => void;
}) {
  const present = sellerIsPresent(seller, core.profile, core.presenceOf(seller.onixId));
  const isSelf = Boolean(core.profile && core.profile.onixId === seller.onixId);

  return (
    <Card className={`profile-card seller-identity${compact ? ' seller-identity--compact' : ''}`}>
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
          {trust && <span><b>Уровень {trust.level}</b> доверия</span>}
          {trust && <span><b>{money(trust.depositTotal)}</b> залог</span>}
        </div>
      </div>
      {!isSelf && (onOpen || onWrite || onToggleFollow) && (
        <div className="card-actions">
          {onOpen && <Button type="button" variant="secondary" onClick={onOpen}>Профиль</Button>}
          {onWrite && <Button type="button" variant="secondary" onClick={onWrite}>Написать</Button>}
          {onToggleFollow && (
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
