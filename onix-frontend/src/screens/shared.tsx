import { useEffect, useState, type ReactNode } from 'react';
import { api, money } from '../api/client';
import {
  API_PATHS, BAN_REASON_OPTIONS, CATEGORIES, SUBCATEGORIES_BY_CATEGORY,
  formatLastSeen, isOnline, sellerIsPresent, type BanReasonCode, type Deal, type OrderListStatus, type PlatformStatus, type Product, type ProductDraft, type ProductStatus, type PublicProfile, type Seller, type TrustCard,
} from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { ReviewCard } from '../components/ReviewCard';
import { Badge, Button, Card, Field, Modal, Select, StateView, Textarea } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
import type { Core } from './types';
import { ProductLotCard } from './ProductLotCard';
import { t } from '../i18n';

export const emptyDraft: ProductDraft = {
  title: '', description: '', priceRubles: '', quantity: 1,
  category: CATEGORIES[0], subcategory: SUBCATEGORIES_BY_CATEGORY[CATEGORIES[0]][0],
  autoDeliver: false, deliveryText: '', warrantyHours: 10, acceptedRules: false,
};

export const dealLabels: Record<Deal['status'], string> = {
  PENDING: 'Ожидает оплаты', PAYMENT_HOLD: 'Деньги в сейфе', DELIVERING: 'Передача товара',
  COMPLETED: 'Завершено', CANCELED: 'Отменено', DISPUTE: 'Открыт спор', REFUNDED: 'Возвращено',
};

/** Rich status banner copy for the order card UI (tones match existing badge colors). */
export function dealStatusView(status: Deal['status']): {
  tone: 'success' | 'danger' | 'warning' | 'neutral' | 'accent';
  title: string;
  detail: string;
  badge: string;
  icon: 'refund' | 'fail' | 'hold' | 'deliver' | 'done' | 'dispute' | 'pending';
} {
  switch (status) {
    case 'REFUNDED':
      return {
        tone: 'success',
        title: 'Возврат оформлен',
        detail: 'Средства возвращены покупателю',
        badge: 'ВОЗВРАЩЕНО',
        icon: 'refund',
      };
    case 'CANCELED':
      return {
        tone: 'danger',
        title: 'Сделка не удалась',
        detail: 'Заказ отменён до завершения',
        badge: 'ОТМЕНЕНО',
        icon: 'fail',
      };
    case 'COMPLETED':
      return {
        tone: 'success',
        title: 'Сделка завершена',
        detail: 'Деньги выплачены продавцу',
        badge: 'ЗАВЕРШЕНО',
        icon: 'done',
      };
    case 'DISPUTE':
      return {
        tone: 'danger',
        title: 'Открыт спор',
        detail: 'Сделка передана в поддержку',
        badge: 'СПОР',
        icon: 'dispute',
      };
    case 'DELIVERING':
      return {
        tone: 'accent',
        title: 'Передача товара',
        detail: 'Ожидается подтверждение покупателя',
        badge: 'ПЕРЕДАЧА',
        icon: 'deliver',
      };
    case 'PAYMENT_HOLD':
      return {
        tone: 'warning',
        title: 'Деньги в сейфе',
        detail: 'Ожидается передача товара',
        badge: 'СЕЙФ',
        icon: 'hold',
      };
    case 'PENDING':
    default:
      return {
        tone: 'neutral',
        title: 'Ожидает оплаты',
        detail: 'Оплата ещё не поступила',
        badge: 'ОЖИДАНИЕ',
        icon: 'pending',
      };
  }
}

export const DEAL_FILTERS: Array<{ id: string; label: string; status?: OrderListStatus }> = [
  { id: 'all', label: 'Все' },
  { id: 'open', label: 'Незавершённые', status: 'open' },
  { id: 'completed', label: 'Завершённые', status: 'completed' },
];

const STATUS_LABEL: Record<PlatformStatus, string> = {
  USER: 'USER',
  VERIFIED_SELLER: 'ПРОВЕРЕН',
  MODERATOR: 'МОДЕРАТОР',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'Основатель',
  VIP: 'VIP',
};

/** @deprecated use status from profile — kept for call sites during Stage 2. */
export function staffBadgeFromRoles(roles: PlatformStatus[]): PlatformStatus | undefined {
  if (roles.includes('SUPER_ADMIN')) return 'SUPER_ADMIN';
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('MODERATOR')) return 'MODERATOR';
  if (roles.includes('VIP')) return 'VIP';
  if (roles.includes('VERIFIED_SELLER')) return 'VERIFIED_SELLER';
  return undefined;
}

export function StaffBadge({ badge }: { badge?: PlatformStatus | 'SUPPORT' }) {
  if (!badge || badge === 'USER' || badge === 'VERIFIED_SELLER' || badge === 'VIP') return null;
  const status: PlatformStatus = badge === 'SUPPORT' ? 'MODERATOR' : badge;
  const tone = status === 'ADMIN' || status === 'SUPER_ADMIN' || status === 'MODERATOR'
    ? 'staff'
    : status === 'VIP'
      ? 'vip'
      : status === 'VERIFIED_SELLER'
        ? 'verified'
        : 'staff';
  return <span className={`badge badge--${tone}`}>{STATUS_LABEL[status]}</span>;
}

export function MessageText({
  text, onOpenOnix, onOpenLot,
}: {
  text: string;
  onOpenOnix: (onixId: string) => void;
  onOpenLot?: (lotNumber: number) => void;
}) {
  const parts = text.split(/(ONIXLOT-\d+|onixlot-\d+|ONIX-\d+)/gi);
  return <>{parts.map((part, index) => {
    if (/^ONIXLOT-\d+$/i.test(part)) {
      const lotNumber = Number(part.replace(/ONIXLOT-/i, ''));
      if (!onOpenLot || !Number.isFinite(lotNumber)) return <span key={index}>{`ONIXLOT-${lotNumber}`}</span>;
      return (
        <button
          key={`${index}-lot-${lotNumber}`}
          type="button"
          className="onix-id-link"
          onClick={() => onOpenLot(lotNumber)}
        >{`ONIXLOT-${lotNumber}`}</button>
      );
    }
    if (/^ONIX-\d+$/i.test(part)) {
      const onixId = part.toUpperCase();
      return <button key={`${index}-${onixId}`} type="button" className="onix-id-link" onClick={() => onOpenOnix(onixId)}>{formatOnixId(onixId)}</button>;
    }
    return <span key={index}>{part}</span>;
  })}</>;
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="section-head"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

export const DEAL_PHASES = ['Оплата', 'Сейф', 'Передача', 'Подтверждение', 'Выплата'] as const;

export function dealProgress(status: Deal['status']) {
  return ({
    PENDING: 0,
    PAYMENT_HOLD: 1,
    DELIVERING: 3,
    COMPLETED: 4,
    CANCELED: -1,
    DISPUTE: 1,
    REFUNDED: -1,
  })[status];
}

export function PublicProfileModal({
  profile, title = 'Профиль', onClose, core, onOpenOnix, onWrite, onOpenProduct, onReport, setToast,
}: {
  profile: PublicProfile | null;
  title?: string;
  onClose: () => void;
  core?: Core;
  onOpenOnix?: (onixId: string) => void;
  onWrite?: (onixId: string) => void | Promise<void>;
  onOpenProduct?: (productId: string) => void;
  onReport?: (onixId: string) => void;
  setToast?: (text: string) => void;
}) {
  const [section, setSection] = useState<'products' | 'reviews'>('products');
  const [followed, setFollowed] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [favorited, setFavorited] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [socialList, setSocialList] = useState<'followers' | 'following' | null>(null);
  const [socialPeople, setSocialPeople] = useState<Seller[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [trustCard, setTrustCard] = useState<TrustCard | null>(null);
  useEffect(() => {
    if (!profile) return;
    setFollowed(Boolean(profile.followed));
    setFollowersCount(profile.followersCount);
    setFollowingCount(profile.followingCount ?? 0);
    setFavorited(Boolean(profile.favorited));
    setBlocked(Boolean(profile.blocked));
    setSocialList(null);
    setSocialPeople([]);
    setSection('products');
    setReportOpen(false);
    setTrustCard(null);
    let cancelled = false;
    void api.get<TrustCard>(API_PATHS.userTrustCard(profile.onixId)).then((card) => {
      if (!cancelled) setTrustCard(card);
    }).catch(() => {
      if (!cancelled) setTrustCard(null);
    });
    return () => { cancelled = true; };
  }, [profile?.onixId, profile?.followed, profile?.followersCount, profile?.followingCount, profile?.favorited, profile?.blocked]);
  if (!profile) return null;
  const products = profile.products ?? [];
  const reviews = profile.reviews ?? [];
  const isSelf = Boolean(core?.profile && core.profile.onixId === profile.onixId);
  const isSeller = products.length > 0 || profile.salesCount > 0;

  const openSocialList = async (kind: 'followers' | 'following') => {
    if (!core) return;
    setSocialList(kind);
    setSocialPeople([]);
    try {
      const people = kind === 'followers'
        ? await core.listFollowers(profile.onixId)
        : await core.listFollowing(profile.onixId);
      setSocialPeople(people);
    } catch {
      setSocialPeople([]);
    }
  };

  const asMarketProduct = (item: NonNullable<PublicProfile['products']>[number]): Product => ({
    id: item.id,
    lotNumber: item.lotNumber,
    title: item.title,
    description: item.description,
    priceCents: item.priceCents,
    quantity: item.quantity,
    category: item.category,
    subcategory: item.subcategory,
    status: (item.status as ProductStatus) || 'ACTIVE',
    seller: {
      id: profile.id,
      onixId: profile.onixId,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      rating: profile.rating,
      reviewCount: profile.reviewCount,
      salesCount: profile.salesCount,
      followersCount: followersCount,
      lastOnline: profile.lastOnline,
      badge: profile.badge,
      status: profile.status,
    },
    createdAt: item.createdAt,
    warrantyHours: item.warrantyHours,
  });

  return <Modal open={Boolean(profile)} title={title} onClose={onClose} size="wide">
    <div className="stack public-profile">
      <Card className="profile-card">
        <UserAvatar userId={profile.id} avatarUrl={profile.avatarUrl} name={profile.username} size="medium" online={isOnline(profile.lastOnline)} />
        <div className="profile-main">
          <h1>{publicAt(profile.username)} <StaffBadge badge={profile.badge} /></h1>
          <p>{formatOnixId(profile.onixId)} · {formatLastSeen(profile.lastOnline)}</p>
          <div className="stats">
            <span><b>★ {profile.rating.toFixed(1)}</b> рейтинг</span>
            <span><b>{profile.salesCount}</b> сделок</span>
            <button
              type="button"
              className="stats__link"
              onClick={() => void openSocialList('followers')}
              disabled={!core}
            >
              <b>{followersCount}</b> {t('social.followers').toLowerCase()}
            </button>
            <button
              type="button"
              className="stats__link"
              onClick={() => void openSocialList('following')}
              disabled={!core}
            >
              <b>{followingCount}</b> {t('social.following').toLowerCase()}
            </button>
          </div>
        </div>
        {!isSelf && core && <div className="card-actions">
          {onWrite && <Button
            variant="secondary"
            busy={core.actionBusy === `chat-${profile.onixId}`}
            onClick={() => void onWrite(profile.onixId)}
          >Написать</Button>}
          {isSeller && <Button
            variant="secondary"
            busy={core.actionBusy === `follow-${profile.onixId}`}
            onClick={async () => {
              const previousFollowed = followed;
              const previousCount = followersCount;
              setFollowed(!previousFollowed);
              setFollowersCount(Math.max(0, previousCount + (previousFollowed ? -1 : 1)));
              const result = await core.toggleFollow(profile.onixId, previousFollowed);
              if (!result) {
                setFollowed(previousFollowed);
                setFollowersCount(previousCount);
                return;
              }
              setFollowed(result.followed);
              setFollowersCount(result.followersCount);
            }}
          >{followed ? 'Отписаться' : 'Подписаться'}</Button>}
          <Button
            variant="secondary"
            busy={core.actionBusy === `user-favorite-${profile.onixId}`}
            onClick={async () => {
              const previous = favorited;
              setFavorited(!previous);
              const result = await core.toggleUserFavorite(profile.onixId, previous);
              if (!result) {
                setFavorited(previous);
                return;
              }
              setFavorited(result.favorited);
            }}
          >{favorited ? t('social.favoriteRemove') : t('social.favoriteAdd')}</Button>
          <Button
            variant="secondary"
            busy={core.actionBusy === `user-block-${profile.onixId}`}
            onClick={async () => {
              const previous = blocked;
              const previousFavorited = favorited;
              setBlocked(!previous);
              if (!previous) setFavorited(false);
              const result = await core.toggleUserBlock(profile.onixId, previous);
              if (!result) {
                setBlocked(previous);
                setFavorited(previousFavorited);
                return;
              }
              setBlocked(result.blocked);
              if (result.blocked) {
                setFavorited(false);
                setToast?.(t('social.block'));
                onClose();
              }
            }}
          >{blocked ? t('social.unblock') : t('social.block')}</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (onReport) onReport(profile.onixId);
              else setReportOpen(true);
            }}
          >Пожаловаться</Button>
        </div>}
        {trustCard && (
          <div className="balance">
            <small>ЗАЛОГ</small>
            <strong>{money(trustCard.depositTotal)}</strong>
          </div>
        )}
      </Card>
      {profile.bio && <p className="muted public-profile__bio">{profile.bio}</p>}
      {profile.createdAt && <p className="muted">На ONIX с {new Date(profile.createdAt).toLocaleDateString('ru-RU')}</p>}
      <div className="profile-tabs game-page__subs" role="tablist" aria-label="Разделы профиля">
        <button
          type="button"
          role="tab"
          aria-selected={section === 'products'}
          className={`game-page__sub${section === 'products' ? ' is-active' : ''}`}
          onClick={() => setSection('products')}
        >
          <span className="game-page__sub-label">Товары</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'reviews'}
          className={`game-page__sub${section === 'reviews' ? ' is-active' : ''}`}
          onClick={() => setSection('reviews')}
        >
          <span className="game-page__sub-label">Отзывы</span>
        </button>
      </div>
      {section === 'products' && (products.length === 0
        ? <StateView title="Товаров нет" text="Продавец ещё не разместил лоты." />
        : <div className="product-grid product-grid--compact">{products.map(item => {
          const product = asMarketProduct(item);
          if (!core) {
            return (
              <Card key={item.id} interactive={Boolean(onOpenProduct && item.status === 'ACTIVE')} className="product-card product-card--compact">
                <button type="button" className="product-main" disabled={!onOpenProduct || item.status !== 'ACTIVE'} onClick={() => onOpenProduct?.(item.id)} aria-label={`Открыть ${item.title}`}>
                  <h2>{item.title}</h2>
                  <div className="seller-row"><span className="muted">{item.category}</span><strong>{money(item.priceCents)}</strong></div>
                </button>
              </Card>
            );
          }
          return (
            <ProductLotCard
              key={item.id}
              product={product}
              online={sellerIsPresent(product.seller, core.profile, core.presenceOf(product.seller.onixId))}
              onOpen={() => onOpenProduct?.(item.id)}
              hidePrice={false}
              footer={item.status !== 'ACTIVE' ? (
                <div className="product-card__footer product-card__footer--bar">
                  <Badge tone="warning">{item.status}</Badge>
                  <strong className="product-card__price">{money(item.priceCents)}</strong>
                </div>
              ) : undefined}
            />
          );
        })}</div>)}
      {section === 'reviews' && (reviews.length === 0
        ? <StateView title="Отзывов нет" text="Пока никто не оставил отзыв." />
        : <div className="review-list">{reviews.map(review => (
          <ReviewCard
            key={review.id}
            review={review}
            authorBadge={<StaffBadge badge={review.author.badge} />}
            onOpenAuthor={onOpenOnix}
          />
        ))}</div>)}
    </div>
    <Modal
      open={socialList !== null}
      title={socialList === 'following' ? t('social.following') : t('social.followers')}
      onClose={() => {
        setSocialList(null);
        setSocialPeople([]);
      }}
    >
      {socialPeople.length === 0 ? (
        <StateView
          title={socialList === 'following' ? t('social.followingEmpty') : t('social.followersEmpty')}
          text=""
        />
      ) : (
        <div className="stack">
          {socialPeople.map((person) => (
            <button
              key={person.onixId}
              type="button"
              className="thread"
              onClick={() => {
                setSocialList(null);
                setSocialPeople([]);
                onOpenOnix?.(person.onixId);
              }}
            >
              <span className="thread-peer">
                <UserAvatar userId={person.id} avatarUrl={person.avatarUrl} name={person.username} />
                <span>
                  <b>{publicAt(person.username)} <StaffBadge badge={person.badge} /></b>
                  <small>{formatOnixId(person.onixId)}</small>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
    {core && setToast && reportOpen && (
      <ReportUserModal
        onixId={profile.onixId}
        core={core}
        onClose={() => setReportOpen(false)}
        setToast={setToast}
      />
    )}
  </Modal>;
}

export function ReportUserModal({
  onixId, core, onClose, setToast,
}: {
  onixId: string | null;
  core: Core;
  onClose: () => void;
  setToast: (text: string) => void;
}) {
  const [reason, setReason] = useState<BanReasonCode>('FRAUD');
  const [comment, setComment] = useState('');
  if (!onixId) return null;
  return <Modal open title="Пожаловаться" onClose={onClose}>
    <form className="form" onSubmit={async (event) => {
      event.preventDefault();
      if (!comment.trim()) return;
      if (await core.reportUser(onixId, reason, comment.trim())) {
        setToast('Жалоба отправлена.');
        onClose();
      }
    }}>
      <Field label="Причина">
        <Select value={reason} onChange={(event) => setReason(event.target.value as BanReasonCode)}>
          {BAN_REASON_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Комментарий">
        <Textarea required maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} />
      </Field>
      <div className="modal__actions">
        <Button type="button" variant="secondary" onClick={onClose}>Отмена</Button>
        <Button type="submit" busy={core.actionBusy === `report-${onixId}`} disabled={!comment.trim()}>Отправить</Button>
      </div>
    </form>
  </Modal>;
}
