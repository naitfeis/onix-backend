import { useEffect, useState, type ReactNode } from 'react';
import { api, friendlyError, money } from '../api/client';
import {
  API_PATHS, BAN_REASON_OPTIONS, CATEGORIES, SUBCATEGORIES_BY_CATEGORY,
  formatLastSeen, isOnline, type BanReasonCode, type Deal, type OrderListStatus, type PlatformStatus, type ProductDraft, type PublicProfile, type TrustCard,
} from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Badge, Button, Card, Confirm, Field, Input, Modal, Select, StateView, Textarea } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
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

const STATUS_LABEL: Record<PlatformStatus, string> = {
  USER: 'USER',
  VERIFIED_SELLER: 'ПРОВЕРЕН',
  MODERATOR: 'МОДЕРАТОР',
  ADMIN: 'ADMIN',
  VIP: 'VIP',
};

/** @deprecated use status from profile — kept for call sites during Stage 2. */
export function staffBadgeFromRoles(roles: PlatformStatus[]): PlatformStatus | undefined {
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('MODERATOR')) return 'MODERATOR';
  if (roles.includes('VIP')) return 'VIP';
  if (roles.includes('VERIFIED_SELLER')) return 'VERIFIED_SELLER';
  return undefined;
}

export function StaffBadge({ badge }: { badge?: PlatformStatus | 'SUPPORT' }) {
  if (!badge || badge === 'USER') return null;
  const status: PlatformStatus = badge === 'SUPPORT' ? 'MODERATOR' : badge;
  const tone = status === 'ADMIN' || status === 'MODERATOR'
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
  const [sellBanned, setSellBanned] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const [banReason, setBanReason] = useState<BanReasonCode | ''>('');
  const [banComment, setBanComment] = useState('');
  const [banDays, setBanDays] = useState('');
  const [sellBanConfirm, setSellBanConfirm] = useState(false);
  useEffect(() => {
    if (!profile) return;
    setFollowed(Boolean(profile.followed));
    setFollowersCount(profile.followersCount);
    setSellBanned(Boolean(profile.sellBanned));
    setSection('products');
    setReportOpen(false);
    setBanOpen(false);
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
  const isAdmin = Boolean(
    core?.profile?.isAdmin
    || core?.profile?.status === 'ADMIN'
    || core?.profile?.roles.includes('ADMIN'),
  );
  const banReady = Boolean(banReason && banComment.trim() && (banReason !== 'OTHER' || Number(banDays) > 0));

  return <Modal open title="Профиль" onClose={onClose} size="wide">
    <div className="stack public-profile">
      <Card className="profile-card">
        <UserAvatar avatarUrl={profile.avatarUrl} name={profile.username} size="medium" online={isOnline(profile.lastOnline)} />
        <div className="profile-main">
          <h1>{publicAt(profile.username)} <StaffBadge badge={profile.badge} /></h1>
          <p>{formatOnixId(profile.onixId)} · {formatLastSeen(profile.lastOnline)}</p>
          <div className="stats">
            <span><b>★ {profile.rating.toFixed(1)}</b> рейтинг</span>
            <span><b>{profile.salesCount}</b> сделок</span>
            <span><b>{followersCount}</b> подписчиков</span>
            {trustCard && <span><b>Уровень {trustCard.level}</b> доверия</span>}
            {trustCard && <span><b>{money(trustCard.depositTotal)}</b> залог</span>}
            {trustCard?.passportVerified && <span><b>Паспорт</b> подтверждён</span>}
            {trustCard?.phoneVerified && <span><b>Телефон</b> подтверждён</span>}
            {trustCard?.voiceVerified && <span><b>Голос</b> подтверждён</span>}
            {isAdmin && sellBanned && <span><b>Продажа</b> запрещена</span>}
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
          {isAdmin && (
            <>
              <Button variant="danger" onClick={() => setBanOpen(true)}>Бан</Button>
              <Button variant="secondary" onClick={() => setSellBanConfirm(true)}>
                {sellBanned ? 'Разрешить продажу' : 'Запрет продажи'}
              </Button>
            </>
          )}
        </div>}
        <div className="balance">
          <small>ЗАЛОГ</small>
          <strong>{money(trustCard?.depositTotal ?? '0')}</strong>
        </div>
      </Card>
      <p className="muted">Пополняется продавцом добровольно. Используется как дополнительная гарантия.</p>
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
            ? <button type="button" className="linkish" onClick={() => onOpenOnix(review.author.onixId!)}><b>{publicAt(review.author.username)}</b> <StaffBadge badge={review.author.badge} /></button>
            : <b>{publicAt(review.author.username)} <StaffBadge badge={review.author.badge} /></b>}
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
    {core && setToast && (
      <Modal open={banOpen} title="Заблокировать пользователя" onClose={() => setBanOpen(false)}>
        <div className="form">
          <Field label="Причина">
            <Select value={banReason} onChange={(e) => setBanReason(e.target.value as BanReasonCode | '')}>
              <option value="">Выберите причину</option>
              {BAN_REASON_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </Select>
          </Field>
          {banReason === 'OTHER' && (
            <Field label="Срок, дней"><Input type="number" min={1} value={banDays} onChange={(e) => setBanDays(e.target.value)} /></Field>
          )}
          <Field label="Комментарий"><Textarea maxLength={500} value={banComment} onChange={(e) => setBanComment(e.target.value)} /></Field>
          <div className="modal__actions">
            <Button variant="secondary" onClick={() => setBanOpen(false)}>Отмена</Button>
            <Button
              variant="danger"
              disabled={!banReady}
              busy={core.actionBusy === 'admin-ban'}
              onClick={async () => {
                if (!banReason || !banComment.trim()) return;
                const ok = await core.adminAction('ban', profile.onixId, {
                  reason: banReason,
                  comment: banComment.trim(),
                  ...(banReason === 'OTHER' && banDays ? { durationDays: Number(banDays) } : {}),
                });
                if (!ok) return;
                setBanOpen(false);
                setToast('Пользователь заблокирован.');
                onClose();
              }}
            >Заблокировать</Button>
          </div>
        </div>
      </Modal>
    )}
    {core && setToast && (
      <Confirm
        open={sellBanConfirm}
        dangerous={!sellBanned}
        title={sellBanned ? 'Снять запрет продажи?' : 'Запретить продажу?'}
        text={sellBanned
          ? 'Пользователь снова сможет публиковать лоты.'
          : 'Активные лоты будут сняты. Аккаунт останется доступен.'}
        busy={core.actionBusy === `sell-ban-${profile.onixId}`}
        onCancel={() => setSellBanConfirm(false)}
        onConfirm={async () => {
          try {
            await api.patch(API_PATHS.adminSellBan(profile.onixId), {
              banned: !sellBanned,
              ...(!sellBanned ? { comment: 'Запрет продажи из профиля' } : {}),
            });
            setSellBanned(!sellBanned);
            setSellBanConfirm(false);
            setToast(sellBanned ? 'Продажа снова разрешена.' : 'Продажа запрещена.');
          } catch (error) {
            setToast(friendlyError(error));
          }
        }}
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
