import { useEffect, useState, lazy, Suspense } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, formatLastSeen, type Product, type ProductDraft, type PublicProfile } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Badge, Button, Card, Field, Input, Modal, Skeleton, StateView, Textarea } from '../design-system';
import { validateDraft } from '../utils/productValidation';
import type { Core, Screen } from './types';
import { PublicProfileModal, StaffBadge, emptyDraft, staffBadgeFromRoles } from './shared';

const Admin = lazy(() => import('./Admin'));

export function EditProduct({ product, core, onClose, setToast }: { product: Product | null; core: Core; onClose: () => void; setToast: (text: string) => void }) {
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  useEffect(() => {
    if (product) {
      setDraft({
        title: product.title,
        description: product.description || '',
        priceRubles: String(Number(product.priceCents) / 100),
        quantity: product.quantity,
        category: product.category,
        subcategory: product.subcategory || '',
        autoDeliver: Boolean(product.autoDeliver),
        deliveryText: '',
      });
    }
  }, [product]);
  return <Modal open={Boolean(product)} title="Редактировать товар" onClose={onClose}><form className="form" onSubmit={async event => {
    event.preventDefault();
    if (!product) return;
    const keepSecret = Boolean(product.autoDeliver && draft.autoDeliver && !draft.deliveryText?.trim());
    if (validateDraft(draft, { keepDeliverySecret: keepSecret }).length === 0 && await core.updateProduct(product.id, draft)) {
      setToast('Изменения сохранены.');
      onClose();
    }
  }}>
    <Field label="Название"><Input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></Field>
    <Field label="Описание"><Textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field>
    <div className="form-grid"><Field label="Цена, ₽"><Input value={draft.priceRubles} onChange={event => setDraft({ ...draft, priceRubles: event.target.value })} /></Field><Field label="Количество"><Input type="number" min={1} value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: Number(event.target.value) })} /></Field></div>
    <label className="check-row"><input type="checkbox" checked={Boolean(draft.autoDeliver)} onChange={event => setDraft({ ...draft, autoDeliver: event.target.checked })} /> Автоматическая выдача</label>
    {draft.autoDeliver && <Field label="Текст товара" hint={product?.autoDeliver ? 'Оставьте пустым, чтобы сохранить текущий секрет. Новый текст заменит старый.' : 'login / password / код — выдаётся один раз после оплаты'}>
      <Textarea maxLength={4000} value={draft.deliveryText || ''} onChange={event => setDraft({ ...draft, deliveryText: event.target.value })} />
    </Field>}
    <div className="modal__actions"><Button type="button" variant="danger" busy={core.actionBusy === `archive-${product?.id}`} onClick={async () => {
      if (product && await core.archiveProduct(product.id)) { setToast('Лот снят с публикации.'); onClose(); }
    }}>Снять</Button><Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit" busy={core.actionBusy === 'product-form'}>Сохранить</Button></div>
  </form></Modal>;
}

export function Profile({
  core, switchTo, setToast, openDirectChat, openProductCard,
}: {
  core: Core;
  switchTo: (screen: Screen) => void;
  setToast: (text: string) => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  openProductCard: (productId: string) => void;
}) {
  const [section, setSection] = useState<'overview' | 'listings' | 'favorites' | 'reviews' | 'admin'>('overview');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [amount, setAmount] = useState('');
  const [authorProfile, setAuthorProfile] = useState<PublicProfile | null>(null);
  const [favoriteProducts, setFavoriteProducts] = useState<Product[]>([]);
  const [favoritesState, setFavoritesState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const profile = core.profile;
  useEffect(() => {
    if (section !== 'favorites' || !core.profile) return;
    let cancelled = false;
    setFavoritesState('loading');
    void core.listFavorites().then((rows) => {
      if (cancelled) return;
      setFavoriteProducts(rows);
      setFavoritesState('success');
    }).catch(() => {
      if (cancelled) return;
      setFavoriteProducts([]);
      setFavoritesState('error');
    });
    return () => { cancelled = true; };
  }, [core.listFavorites, core.profile, section]);
  if (core.states.profile === 'loading') return <Card><Skeleton lines={6} /></Card>;
  if (!profile) return <StateView title="Профиль недоступен" text={core.errors.profile || 'Войдите через Telegram.'} action={<Button onClick={core.refreshAll}>Обновить</Button>} />;
  const ownProducts = core.products.filter(product => product.seller.id === profile.id);
  const profileSections: Array<'overview' | 'listings' | 'favorites' | 'reviews' | 'admin'> =
    profile.roles.includes('ADMIN') ? ['overview', 'listings', 'favorites', 'reviews', 'admin'] : ['overview', 'listings', 'favorites', 'reviews'];
  const openAuthorProfile = async (onixId: string) => {
    if (authorProfile?.onixId === onixId) return;
    try { setAuthorProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixId))); } catch { /* ignore */ }
  };
  return <div className="stack"><Card className="profile-card"><UserAvatar avatarUrl={profile.avatarUrl} name={profile.username} size="medium" /><div className="profile-main"><h1>@{profile.username} <StaffBadge badge={staffBadgeFromRoles(profile.roles)} /></h1><p>{profile.onixId} · {formatLastSeen(profile.lastOnline)}</p><div className="stats"><span><b>★ {profile.rating.toFixed(1)}</b> рейтинг</span><span><b>{profile.salesCount}</b> сделок</span><span><b>{profile.followersCount}</b> подписчиков</span></div></div>
      <div className="balance"><small>БАЛАНС</small><strong>{money(profile.balanceCents)}</strong><Button variant="secondary" onClick={() => setWithdrawOpen(true)}>Вывести</Button></div></Card>
    <div className="chips profile-tabs">{profileSections.map(item =>
      <button className={section === item ? 'active' : ''} key={item} onClick={() => setSection(item)}>{({ overview: 'ИСТОРИЯ', listings: 'МОИ ТОВАРЫ', favorites: 'ИЗБРАННОЕ', reviews: 'ОТЗЫВЫ', admin: 'ADMIN' })[item]}</button>)}</div>
    {section === 'overview' && <Card><h2>// ИСТОРИЯ БАЛАНСА</h2>{profile.walletHistory.length === 0 ? <p className="empty-inline">Операций пока нет.</p> : <div className="operations">{profile.walletHistory.map(item => <div key={item.id}><span><b>{item.type}</b><small>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</small></span><strong>{money(item.amountCents)}</strong></div>)}</div>}</Card>}
    {section === 'favorites' && (favoritesState === 'loading' ? <Card><Skeleton lines={4} /></Card> :
      favoritesState === 'error' ? <StateView title="Избранное недоступно" text="Не удалось загрузить список." /> :
      favoriteProducts.length === 0 ? <StateView title="Избранное пусто" text="Отмечайте товары сердцем на витрине." action={<Button onClick={() => switchTo('market')}>На рынок</Button>} /> :
      <div className="product-grid">{favoriteProducts.map(item => (
        <Card key={item.id} interactive className="product-card">
          <button
            type="button"
            className="product-main"
            onClick={() => openProductCard(item.id)}
            aria-label={`Открыть ${item.title}`}
          >
            <h2>{item.title}</h2>
            <div className="seller-row">
              <span className="user-summary">
                <UserAvatar avatarUrl={item.seller.avatarUrl} name={item.seller.username} />
                <span>@{item.seller.username}</span>
              </span>
              <strong>{money(item.priceCents)}</strong>
            </div>
          </button>
        </Card>
      ))}</div>)}
    {section === 'listings' && (ownProducts.length === 0 ? <StateView title="У вас нет товаров" text="Создайте первый лот — он появится здесь." action={<Button onClick={() => switchTo('create')}>Создать лот</Button>} /> :
      <div className="product-grid">{ownProducts.map(item => <Card key={item.id}><Badge tone={item.status === 'ACTIVE' ? 'success' : 'warning'}>{item.status}</Badge><h2>{item.title}</h2><div className="seller-row"><strong>{money(item.priceCents)}</strong><Button variant="secondary" onClick={() => setEditing(item)}>Редактировать</Button></div></Card>)}</div>)}
    {section === 'reviews' && (core.reviews.length === 0 ? <StateView title="Отзывов пока нет" text="Отзывы можно оставить после завершённой сделки." /> :
      core.reviews.map(review => <Card key={review.id}><div className="seller-row">
        {review.author.onixId
          ? <button type="button" className="linkish" onClick={() => void openAuthorProfile(review.author.onixId!)}><b>@{review.author.username}</b> <StaffBadge badge={review.author.badge} /></button>
          : <b>@{review.author.username} <StaffBadge badge={review.author.badge} /></b>}
        <span>{'★'.repeat(review.rating)}</span>
      </div><p className="muted">{review.text}</p></Card>))}
    {section === 'admin' && profile.roles.includes('ADMIN') && (
      <Suspense fallback={<Card><Skeleton lines={4} /></Card>}>
        <Admin core={core} setToast={setToast} />
      </Suspense>
    )}
    <PublicProfileModal
      profile={authorProfile}
      onClose={() => setAuthorProfile(null)}
      core={core}
      onOpenOnix={openAuthorProfile}
      onWrite={async (onixId) => {
        setAuthorProfile(null);
        await openDirectChat(onixId);
      }}
      onOpenProduct={(productId) => {
        setAuthorProfile(null);
        openProductCard(productId);
      }}
      setToast={setToast}
    />
    <EditProduct product={editing} core={core} onClose={() => setEditing(null)} setToast={setToast} />
    <Modal open={withdrawOpen} title="Вывод средств" onClose={() => setWithdrawOpen(false)}><div className="form"><p className="modal__text">Сумма и комиссия будут подтверждены сервером до списания.</p><Field label="Сумма, ₽"><Input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></Field><div className="modal__actions"><Button variant="secondary" onClick={() => setWithdrawOpen(false)}>Отмена</Button><Button busy={core.actionBusy === 'withdraw'} disabled={Number(amount) < 100} onClick={async () => { if (await core.withdraw(Number(amount))) { setWithdrawOpen(false); setToast('Заявка на вывод создана.'); } }}>Продолжить</Button></div></div></Modal>
  </div>;
}
export default Profile;
