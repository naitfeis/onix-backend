import { useEffect, useState, lazy, Suspense } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, sellerIsPresent, type Product, type ProductDraft, type PublicProfile } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Button, Card, Field, Input, Modal, Skeleton, StateView, Textarea } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { validateDraft } from '../utils/productValidation';
import type { Core, Screen } from './types';
import { PublicProfileModal, StaffBadge, emptyDraft, staffBadgeFromRoles } from './shared';

const Admin = lazy(() => import('./Admin'));
const SupportQueue = lazy(() => import('./SupportQueue'));
const SellerAnalyticsPanel = lazy(() => import('./SellerAnalytics'));

type MoneyModal = 'MAIN_TOPUP' | 'MAIN_WITHDRAW' | 'DEPOSIT_FUND' | 'DEPOSIT_WITHDRAW' | null;

function rublesToCents(rubles: number): number {
  return Math.round(rubles * 100);
}

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
    <Field label="Название" hint="До 32 символов"><Input maxLength={32} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></Field>
    <Field label="Описание"><Textarea maxLength={20000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field>
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
  core, switchTo, setToast, openDirectChat, openProductCard, openDealChat,
}: {
  core: Core;
  switchTo: (screen: Screen) => void;
  setToast: (text: string) => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  openProductCard: (productId: string) => void;
  openDealChat: (chatId: string) => void;
}) {
  const [section, setSection] = useState<'overview' | 'listings' | 'favorites' | 'reviews' | 'analytics' | 'support' | 'admin'>('overview');
  const [moneyOpen, setMoneyOpen] = useState(false);
  const [moneyModal, setMoneyModal] = useState<MoneyModal>(null);
  const [moneyBusy, setMoneyBusy] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [amount, setAmount] = useState('');
  const [authorProfile, setAuthorProfile] = useState<PublicProfile | null>(null);
  const [favoriteProducts, setFavoriteProducts] = useState<Product[]>([]);
  const [favoritesState, setFavoritesState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [historyVisible, setHistoryVisible] = useState(10);
  const profile = core.profile;
  const deposit = profile?.deposit ?? null;
  const ownerTrust = profile?.trustCard ?? null;
  useEffect(() => {
    if (section === 'overview') setHistoryVisible(10);
  }, [section]);

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

  const openMoney = (kind: Exclude<MoneyModal, null>) => {
    setAmount('');
    setMoneyModal(kind);
  };

  const submitMoney = async () => {
    const rubles = Number(amount);
    if (!moneyModal || !(rubles >= 1)) return;
    setMoneyBusy(true);
    try {
      const amountCents = rublesToCents(rubles);
      const key = crypto.randomUUID();
      if (moneyModal === 'MAIN_WITHDRAW') {
        if (!(await core.withdraw(rubles))) return;
        setToast('Заявка на вывод создана.');
      } else if (moneyModal === 'MAIN_TOPUP') {
        const intent = await api.post<{ id: string }>(API_PATHS.paymentsIntents, {
          wallet: 'MAIN',
          amountCents,
          provider: 'MANUAL',
          idempotencyKey: key,
        });
        await api.post(API_PATHS.paymentIntentConfirm(intent.id), {});
        await core.loadProfile();
        setToast('Баланс пополнен.');
      } else if (moneyModal === 'DEPOSIT_FUND') {
        await api.post(API_PATHS.walletDepositTopup, { amountCents, idempotencyKey: key });
        await core.loadProfile();
        setToast('Залог пополнен с баланса.');
      } else if (moneyModal === 'DEPOSIT_WITHDRAW') {
        await api.post(API_PATHS.walletDepositWithdraw, { amountCents, idempotencyKey: key });
        await core.loadProfile();
        setToast('Залог выведен на баланс.');
      }
      setMoneyModal(null);
      setAmount('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Операция недоступна.';
      if (moneyModal === 'MAIN_TOPUP' && (message.includes('не подключ') || message.includes('отключено') || message.includes('Manual'))) {
        setToast('Скоро: Telegram Wallet / ЮKassa. Manual-пополнение пока отключено.');
      } else {
        setToast(message);
      }
    } finally {
      setMoneyBusy(false);
    }
  };

  if (core.states.profile === 'loading') return <Card><Skeleton lines={6} /></Card>;
  if (!profile) return <StateView title="Профиль недоступен" text={core.errors.profile || 'Войдите через Telegram.'} action={<Button onClick={core.refreshAll}>Обновить</Button>} />;
  const ownProducts = core.products.filter(product => product.seller.id === profile.id);
  const status = profile.status ?? (profile.roles[0] ?? 'USER');
  const isStaff = status === 'ADMIN' || status === 'MODERATOR' || profile.isAdmin;
  const isAdmin = status === 'ADMIN' || profile.isAdmin || profile.roles.includes('ADMIN');
  const profileSections: Array<'overview' | 'listings' | 'favorites' | 'reviews' | 'analytics' | 'support' | 'admin'> = [
    'overview', 'listings', 'favorites', 'reviews', 'analytics',
    ...(isStaff ? (['support'] as const) : []),
    ...(isAdmin ? (['admin'] as const) : []),
  ];
  const openAuthorProfile = async (onixId: string) => {
    if (authorProfile?.onixId === onixId) return;
    try { setAuthorProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixId))); } catch { /* ignore */ }
  };

  const moneyTitle = moneyModal === 'MAIN_TOPUP' ? 'Пополнить баланс'
    : moneyModal === 'MAIN_WITHDRAW' ? 'Вывод средств'
    : moneyModal === 'DEPOSIT_FUND' ? 'Пополнить залог'
    : moneyModal === 'DEPOSIT_WITHDRAW' ? 'Вывести залог'
    : '';
  const moneyHint = moneyModal === 'DEPOSIT_FUND'
    ? 'Сумма спишется с основного баланса и зачислится в доступный залог.'
    : moneyModal === 'DEPOSIT_WITHDRAW'
      ? 'Только доступный залог. Замороженные средства после сделки нельзя вывести до конца HOLD.'
      : moneyModal === 'MAIN_TOPUP'
        ? 'Пополнение через PaymentIntent. Позже: Telegram Wallet / ЮKassa.'
        : 'Сумма и комиссия будут подтверждены сервером до списания.';

  return <div className="stack"><Card className="profile-card"><UserAvatar avatarUrl={profile.avatarUrl} name={profile.username} size="medium" online /><div className="profile-main"><h1>@{profile.username} <StaffBadge badge={profile.badge ?? staffBadgeFromRoles(profile.roles)} /></h1><p>{formatOnixId(profile.onixId)} · Online</p><div className="stats"><span><b>★ {profile.rating.toFixed(1)}</b> рейтинг</span><span><b>{profile.salesCount}</b> сделок</span><span><b>{profile.followersCount}</b> подписчиков</span>{ownerTrust && <span><b>Уровень {ownerTrust.level}</b> доверия</span>}</div></div>
      <div className="wallet-strip">
        <button type="button" className="wallet-strip__row" onClick={() => setMoneyOpen((v) => !v)} aria-expanded={moneyOpen}>
          <span><small>Баланс</small><strong>{money(profile.balanceCents)}</strong></span>
          <span><small>Залог</small><strong>{money(deposit?.totalCents ?? '0')}</strong></span>
          <em className={`wallet-strip__chevron${moneyOpen ? ' open' : ''}`} aria-hidden="true">▾</em>
        </button>
        {moneyOpen && (
          <div className="wallet-strip__panel">
            <div className="balance"><small>БАЛАНС</small><strong>{money(profile.balanceCents)}</strong><div className="balance-actions"><Button variant="secondary" onClick={() => openMoney('MAIN_WITHDRAW')}>Вывести</Button><Button variant="secondary" onClick={() => openMoney('MAIN_TOPUP')}>Пополнить</Button></div></div>
            <div className="balance"><small>ЗАЛОГ</small><strong>{money(deposit?.totalCents ?? '0')}</strong><div className="balance-actions"><Button variant="secondary" onClick={() => openMoney('DEPOSIT_WITHDRAW')}>Вывести</Button><Button variant="secondary" onClick={() => openMoney('DEPOSIT_FUND')}>Пополнить</Button></div></div>
            {deposit && <div className="stats"><span><b>{money(deposit.totalCents)}</b> всего</span><span><b>{money(deposit.availableCents)}</b> доступно</span><span><b>{money(deposit.lockedCents)}</b> заморожено</span></div>}
          </div>
        )}
      </div>
    </Card>
    <div className="chips profile-tabs">{profileSections.map(item =>
      <button className={section === item ? 'active' : ''} key={item} onClick={() => setSection(item)}>{({ overview: 'ИСТОРИЯ', listings: 'МОИ ТОВАРЫ', favorites: 'ИЗБРАННОЕ', reviews: 'ОТЗЫВЫ', analytics: 'АНАЛИТИКА', support: 'ПОДДЕРЖКА', admin: 'ADMIN' })[item]}</button>)}</div>
    {section === 'overview' && <Card><h2>// ИСТОРИЯ БАЛАНСА</h2>{profile.walletHistory.length === 0 ? <p className="empty-inline">Операций пока нет.</p> : <>
      <div className="operations">{profile.walletHistory.slice(0, historyVisible).map(item => <div key={item.id}><span><b>{item.type}</b><small>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</small></span><strong>{money(item.amountCents)}</strong></div>)}</div>
      {historyVisible < profile.walletHistory.length && (
        <div className="card-actions" style={{ marginTop: 12 }}>
          <Button variant="secondary" onClick={() => setHistoryVisible((n) => n + 10)}>Показать ещё</Button>
        </div>
      )}
    </>}</Card>}
    {section === 'favorites' && (favoritesState === 'loading' ? <Card><Skeleton lines={4} /></Card> :
      favoritesState === 'error' ? <StateView title="Избранное недоступно" text="Не удалось загрузить список." /> :
      favoriteProducts.length === 0 ? <StateView title="Избранное пусто" text="Отмечайте товары сердцем на витрине." action={<Button onClick={() => switchTo('market')}>На рынок</Button>} /> :
      <div className="product-grid">{favoriteProducts.map(item => (
        <Card key={item.id} interactive className="product-card">
          <button type="button" className="product-main" onClick={() => openProductCard(item.id)} aria-label={`Открыть ${item.title}`}>
            <h2>{item.title}</h2>
            <div className="seller-row">
              <span className="user-summary">
                <UserAvatar avatarUrl={item.seller.avatarUrl} name={item.seller.username} online={sellerIsPresent(item.seller, core.profile)} />
                <span>@{item.seller.username}</span>
              </span>
              <strong>{money(item.priceCents)}</strong>
            </div>
          </button>
        </Card>
      ))}</div>)}
    {section === 'listings' && (ownProducts.length === 0 ? <StateView title="У вас нет товаров" text="Создайте первый лот — он появится здесь." action={<Button onClick={() => switchTo('create')}>Создать лот</Button>} /> :
      <div className="product-grid">{ownProducts.map(item => (
        <Card key={item.id}>
          <h2>{item.title}</h2>
          <div className="listing-meta">
            {item.viewCount != null && <span><b>{item.viewCount}</b> просмотров</span>}
            <span><b>{money(item.priceCents)}</b></span>
          </div>
          <div className="seller-row">
            <Button variant="secondary" onClick={() => setEditing(item)}>Редактировать</Button>
          </div>
        </Card>
      ))}</div>)}
    {section === 'reviews' && (core.reviews.length === 0 ? <StateView title="Отзывов пока нет" text="Отзывы можно оставить после завершённой сделки." /> :
      core.reviews.map(review => <Card key={review.id}><div className="seller-row">
        {review.author.onixId
          ? <button type="button" className="linkish" onClick={() => void openAuthorProfile(review.author.onixId!)}><b>@{review.author.username}</b> <StaffBadge badge={review.author.badge} /></button>
          : <b>@{review.author.username} <StaffBadge badge={review.author.badge} /></b>}
        <span>{'★'.repeat(review.rating)}</span>
      </div><p className="muted">{review.text}</p></Card>))}
    {section === 'analytics' && (
      <Suspense fallback={<Card><Skeleton lines={6} /></Card>}>
        <SellerAnalyticsPanel days={30} />
      </Suspense>
    )}
    {section === 'support' && isStaff && (
      <Suspense fallback={<Card><Skeleton lines={4} /></Card>}>
        <SupportQueue
          core={core}
          setToast={setToast}
          openDealChat={openDealChat}
          openDirectChat={openDirectChat}
          openUserProfile={(onixId) => void openAuthorProfile(onixId)}
        />
      </Suspense>
    )}
    {section === 'admin' && isAdmin && (
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
    <Modal open={Boolean(moneyModal)} title={moneyTitle} onClose={() => setMoneyModal(null)}>
      <div className="form">
        <p className="modal__text">{moneyHint}</p>
        <Field label="Сумма, ₽"><Input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
        <div className="modal__actions">
          <Button variant="secondary" onClick={() => setMoneyModal(null)}>Отмена</Button>
          <Button
            busy={moneyBusy || (moneyModal === 'MAIN_WITHDRAW' && core.actionBusy === 'withdraw')}
            disabled={Number(amount) < 1}
            onClick={() => void submitMoney()}
          >Продолжить</Button>
        </div>
      </div>
    </Modal>
  </div>;
}
export default Profile;
