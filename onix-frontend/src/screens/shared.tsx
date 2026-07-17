import { useEffect, useState, type ReactNode } from 'react';
import { api, money } from '../api/client';
import {
  API_PATHS, BAN_REASON_OPTIONS, CATEGORIES, SUBCATEGORIES_BY_CATEGORY,
  formatLastSeen, type BanReasonCode, type Deal, type OrderListStatus, type ProductDraft, type PublicProfile, type TrustCard,
} from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Badge, Button, Card, Field, Modal, Select, StateView, Textarea } from '../design-system';
import type { Core } from './types';

export const emptyDraft: ProductDraft = {
  title: '', description: '', priceRubles: '', quantity: 1,
  category: CATEGORIES[0], subcategory: SUBCATEGORIES_BY_CATEGORY[CATEGORIES[0]][0],
  autoDeliver: false, deliveryText: '',
};

export const dealLabels: Record<Deal['status'], string> = {
  PENDING: 'Ожидает оплаты', PAYMENT_HOLD: 'Деньги в сейфе', DELIVERING: 'Передача товара',
  COMPLETED: 'Завершено', CANCELED: 'Отменено', DISPUTE: 'Открыт спор', REFUNDED: 'Возвращено',
};

export const DEAL_FILTERS: Array<{ id: string; label: string; status?: OrderListStatus }> = [
  { id: 'all', label: 'Все' },
  { id: 'open', label: 'Незавершённые', status: 'open' },
  { id: 'completed', label: 'Завершённые', status: 'completed' },
];

export function staffBadgeFromRoles(roles: Array<'USER' | 'ADMIN' | 'SUPPORT'>): 'ADMIN' | 'SUPPORT' | undefined {
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('SUPPORT')) return 'SUPPORT';
  return undefined;
}

export function StaffBadge({ badge }: { badge?: 'ADMIN' | 'SUPPORT' }) {
  if (!badge) return null;
  return <span className="badge badge--staff">{badge}</span>;
}

export function MessageText({ text, onOpenOnix }: { text: string; onOpenOnix: (onixId: string) => void }) {
  const parts = text.split(/(ONIX-\d+)/gi);
  return <>{parts.map((part, index) => {
    if (/^ONIX-\d+$/i.test(part)) {
      const onixId = part.toUpperCase();
      return <button key={`${index}-${onixId}`} type="button" className="onix-id-link" onClick={() => onOpenOnix(onixId)}>{onixId}</button>;
    }
    return <span key={index}>{part}</span>;
  })}</>;
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="section-head"><div><h1>// {title}</h1><p>{subtitle}</p></div>{action}</div>;
}

export function dealProgress(status: Deal['status']) {
  return ({ PENDING: 0, PAYMENT_HOLD: 1, DELIVERING: 2, COMPLETED: 3, CANCELED: -1, DISPUTE: 1, REFUNDED: -1 })[status];
}

export function PublicProfileModal({
  profile, onClose, core, onOpenOnix, onWrite, onOpenProduct, onReport, setToast,
}: {
  profile: PublicProfile | null;
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
  const [reportOpen, setReportOpen] = useState(false);
  const [trustCard, setTrustCard] = useState<TrustCard | null>(null);
  useEffect(() => {
    if (!profile) return;
    setFollowed(Boolean(profile.followed));
    setFollowersCount(profile.followersCount);
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
  }, [profile?.onixId, profile?.followed, profile?.followersCount]);
  if (!profile) return null;
  const products = profile.products ?? [];
  const reviews = profile.reviews ?? [];
  const isSelf = Boolean(core?.profile && core.profile.onixId === profile.onixId);
  const isSeller = products.length > 0 || profile.salesCount > 0;

  return <Modal open title="Профиль" onClose={onClose}>
    <div className="stack public-profile">
      <Card className="profile-card">
        <UserAvatar avatarUrl={profile.avatarUrl} name={profile.username} size="medium" />
        <div className="profile-main">
          <h1>@{profile.username} <StaffBadge badge={profile.badge} /></h1>
          <p>{profile.onixId} · {formatLastSeen(profile.lastOnline)}</p>
          <div className="stats">
            <span><b>★ {profile.rating.toFixed(1)}</b> рейтинг</span>
            <span><b>{profile.salesCount}</b> сделок</span>
            <span><b>{followersCount}</b> подписчиков</span>
            {trustCard && <span><b>Уровень {trustCard.level}</b> доверия</span>}
            {trustCard && <span><b>{money(trustCard.depositTotal)}</b> залог</span>}
            {trustCard?.passportVerified && <span><b>Паспорт</b> подтверждён</span>}
            {trustCard?.phoneVerified && <span><b>Телефон</b> подтверждён</span>}
            {trustCard?.voiceVerified && <span><b>Голос</b> подтверждён</span>}
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
            variant="danger"
            onClick={() => {
              if (onReport) onReport(profile.onixId);
              else setReportOpen(true);
            }}
          >Пожаловаться</Button>
        </div>}
        {trustCard && <div className="balance"><small>ЗАЛОГ</small><strong>{money(trustCard.depositTotal)}</strong></div>}
      </Card>
      {profile.bio && <p className="muted public-profile__bio">{profile.bio}</p>}
      {profile.createdAt && <p className="muted">На ONIX с {new Date(profile.createdAt).toLocaleDateString('ru-RU')}</p>}
      <div className="chips profile-tabs">
        <button className={section === 'products' ? 'active' : ''} onClick={() => setSection('products')}>ТОВАРЫ</button>
        <button className={section === 'reviews' ? 'active' : ''} onClick={() => setSection('reviews')}>ОТЗЫВЫ</button>
      </div>
      {section === 'products' && (products.length === 0
        ? <StateView title="Товаров нет" text="Продавец ещё не разместил лоты." />
        : <div className="product-grid">{products.map(item => (
          <Card
            key={item.id}
            interactive={Boolean(onOpenProduct && item.status === 'ACTIVE')}
            className="product-card"
          >
            <button
              type="button"
              className="product-main"
              disabled={!onOpenProduct || item.status !== 'ACTIVE'}
              onClick={() => onOpenProduct?.(item.id)}
              aria-label={`Открыть ${item.title}`}
            >
              <Badge tone={item.status === 'ACTIVE' ? 'success' : 'warning'}>{item.status}</Badge>
              <h2>{item.title}</h2>
              <div className="seller-row"><span className="muted">{item.category}</span><strong>{money(item.priceCents)}</strong></div>
            </button>
          </Card>
        ))}</div>)}
      {section === 'reviews' && (reviews.length === 0
        ? <StateView title="Отзывов нет" text="Пока никто не оставил отзыв." />
        : reviews.map(review => <Card key={review.id}><div className="seller-row">
          {review.author.onixId && onOpenOnix
            ? <button type="button" className="linkish" onClick={() => onOpenOnix(review.author.onixId!)}><b>@{review.author.username}</b> <StaffBadge badge={review.author.badge} /></button>
            : <b>@{review.author.username} <StaffBadge badge={review.author.badge} /></b>}
          <span>{'★'.repeat(review.rating)}</span>
        </div><p className="muted">{review.text}</p></Card>))}
    </div>
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
