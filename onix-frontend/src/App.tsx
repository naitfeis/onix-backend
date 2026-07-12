import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import WebApp from '@twa-dev/sdk';
import { loginWithTelegram, money } from './api/client';
import { CATEGORIES, CATEGORY_LABELS, type Deal, type Product, type ProductDraft } from './api/contracts';
import OnixBackground from './components/OnixBackground';
import UserAvatar from './components/UserAvatar';
import { Badge, Button, Card, Confirm, Field, Input, Modal, Select, Skeleton, StateView, Textarea, Toast } from './design-system';
import { useOnixCore } from './hooks/useOnixCore';
import { validateDraft } from './utils/productValidation';
import './App.css';

type Screen = 'market' | 'deals' | 'create' | 'chat' | 'profile';
const TABS: Array<{ id: Screen; icon: string; label: string }> = [
  { id: 'market', icon: '🛒', label: 'РЫНОК' }, { id: 'deals', icon: '🔒', label: 'СДЕЛКИ' },
  { id: 'create', icon: '📦', label: 'ЛОТ' }, { id: 'chat', icon: '💬', label: 'ЧАТ' },
  { id: 'profile', icon: '◉', label: 'ПРОФИЛЬ' },
];

const emptyDraft: ProductDraft = { title: '', description: '', priceRubles: '', quantity: 1, category: CATEGORIES[0], subcategory: '' };
const dealLabels: Record<Deal['status'], string> = {
  PENDING: 'Ожидает оплаты', PAYMENT_HOLD: 'Деньги в сейфе', DELIVERING: 'Передача товара',
  COMPLETED: 'Завершено', CANCELED: 'Отменено', DISPUTE: 'Открыт спор', REFUNDED: 'Возвращено',
};

function isTelegramMiniApp() {
  try { return Boolean(WebApp.initData); } catch { return false; }
}

export default function App() {
  const core = useOnixCore();
  const [screen, setScreen] = useState<Screen>('market');
  const [direction, setDirection] = useState(1);
  const [toast, setToast] = useState('');
  const switchTo = (next: Screen) => {
    const from = TABS.findIndex(tab => tab.id === screen);
    const to = TABS.findIndex(tab => tab.id === next);
    setDirection(to >= from ? 1 : -1);
    setScreen(next);
    try { WebApp.HapticFeedback.impactOccurred('light'); } catch { /* Browser client. */ }
  };
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timeout);
  }, [toast]);
  const mode = screen === 'chat' ? 'chat' : screen === 'deals' || screen === 'create' ? 'focus' : 'normal';
  const unread = core.unread > 99 ? '99+' : String(core.unread);

  return <div className="app-shell">
    <OnixBackground mode={mode} />
    <a className="skip-link" href="#content">К содержимому</a>
    <header className="topbar">
      <div className="brand" aria-label="ONIX">O N I X</div>
      <div className="identity">
        {core.profile ? <><strong>{money(core.profile.balanceCents)}</strong><span>// @{core.profile.username}</span></> :
          <><strong>ГОСТЬ</strong><span>// БЕЗ СЕССИИ</span></>}
      </div>
    </header>
    {core.states.profile === 'error' && <AuthNotice miniApp={isTelegramMiniApp()} message={core.errors.profile} />}
    <main id="content" className="viewport" style={{ '--direction': direction } as CSSProperties}>
      <div key={screen} className="screen-transition">
        {screen === 'market' && <Market core={core} switchTo={switchTo} setToast={setToast} />}
        {screen === 'deals' && <Deals core={core} setToast={setToast} />}
        {screen === 'create' && <ProductForm core={core} onDone={() => switchTo('market')} setToast={setToast} />}
        {screen === 'chat' && <Chats core={core} />}
        {screen === 'profile' && <Profile core={core} switchTo={switchTo} setToast={setToast} />}
      </div>
    </main>
    <nav className="bottom-nav" aria-label="Основная навигация">
      <span className="nav-indicator" style={{ transform: `translateX(${TABS.findIndex(tab => tab.id === screen) * 100}%)` }} />
      {TABS.map(tab => <button key={tab.id} className={screen === tab.id ? 'active' : ''} onClick={() => switchTo(tab.id)} aria-current={screen === tab.id ? 'page' : undefined}>
        <span aria-hidden="true">{tab.icon}</span><small>{tab.label}</small>
        {tab.id === 'chat' && core.unread > 0 && <b className="nav-count">{unread}</b>}
      </button>)}
    </nav>
    {toast && <Toast message={toast} />}
  </div>;
}

type Core = ReturnType<typeof useOnixCore>;
function AuthNotice({ miniApp, message }: { miniApp: boolean; message?: string }) {
  return <div className="auth-notice" role="alert"><div><strong>{miniApp ? 'Не удалось подтвердить Telegram' : 'Войдите через Telegram'}</strong>
    <span>{message || 'Авторизация нужна для сделок и сообщений.'}</span></div>
    {miniApp ? <Button variant="secondary" onClick={() => location.reload()}>Повторить</Button> :
      <TelegramLogin />}
  </div>;
}

function TelegramLogin() {
  const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;
  const [error, setError] = useState('');
  useEffect(() => {
    if (!bot) return;
    const host = document.getElementById('telegram-login');
    if (!host) return;
    const callback = `onixTelegramAuth_${crypto.randomUUID().replaceAll('-', '')}`;
    const scope = window as unknown as Record<string, unknown>;
    scope[callback] = async (payload: Record<string, string | number>) => {
      console.log("Telegram callback", payload);
      try {
        await loginWithTelegram(payload);
        location.reload();
      } catch {
        setError('Telegram вход не выполнен.');
      }
    };
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.dataset.telegramLogin = bot.replace(/^@/, '');
    script.dataset.size = 'large';
    script.dataset.userpic = 'false';
    script.dataset.onauth = `${callback}(user)`;
    host.replaceChildren(script);
    return () => { delete scope[callback]; host.replaceChildren(); };
  }, [bot]);
  if (!bot) return <span>Настройте VITE_TELEGRAM_BOT_USERNAME</span>;
  return <div><div id="telegram-login" />{error && <small>{error}</small>}</div>;
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="section-head"><div><h1>// {title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function Market({ core, switchTo, setToast }: { core: Core; switchTo: (screen: Screen) => void; setToast: (text: string) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Все');
  const [sort, setSort] = useState('new');
  const [selected, setSelected] = useState<Product | null>(null);
  const [confirm, setConfirm] = useState<Product | null>(null);
  const filtered = useMemo(() => core.products.filter(product => {
    const text = `${product.title} ${product.seller.username} ${product.seller.onixId}`.toLowerCase();
    return (category === 'Все' || product.category === category) && text.includes(query.trim().toLowerCase());
  }).sort((a, b) => sort === 'price' ? Number(a.priceCents) - Number(b.priceCents) :
    sort === 'rating' ? b.seller.rating - a.seller.rating : Date.parse(b.createdAt) - Date.parse(a.createdAt)), [category, core.products, query, sort]);

  return <div className="stack">
    <SectionHeader title="ВИТРИНА ONIX MARKETPLACE" subtitle="БЕЗОПАСНЫЕ ЦИФРОВЫЕ СДЕЛКИ" action={<Button variant="ghost" onClick={() => core.refreshAll()}>↻</Button>} />
    <div className="search-row"><Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Товар, продавец или ONIX ID" aria-label="Поиск" />
      <Select value={sort} onChange={event => setSort(event.target.value)} aria-label="Сортировка"><option value="new">Сначала новые</option><option value="price">Сначала дешевле</option><option value="rating">По рейтингу</option></Select></div>
    <div className="chips" role="list" aria-label="Категории">{['Все', ...CATEGORIES].map(item =>
      <button role="listitem" className={category === item ? 'active' : ''} key={item} onClick={() => setCategory(item)}>{item === 'Все' ? item.toUpperCase() : CATEGORY_LABELS[item as keyof typeof CATEGORY_LABELS].toUpperCase()}</button>)}</div>
    {core.states.products === 'loading' ? <div className="product-grid"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div> :
      core.states.products === 'error' ? <StateView title="Витрина недоступна" text={core.errors.products || ''} action={<Button onClick={() => core.refreshAll()}>Попробовать снова</Button>} /> :
      filtered.length === 0 ? <StateView title="Ничего не найдено" text="Измените запрос или фильтры. Можно разместить собственный лот." action={<Button onClick={() => switchTo('create')}>Разместить лот</Button>} /> :
      <div className="product-grid">{filtered.map(product => <Card key={product.id} interactive className="product-card">
        <button className="product-main" onClick={() => setSelected(product)} aria-label={`Открыть ${product.title}`}>
          <div className="product-card__top"><Badge tone={product.status === 'ACTIVE' ? 'success' : 'warning'}>{product.status}</Badge><span>{product.category}</span></div>
          <h2>{product.title}</h2><p>{product.description || 'Описание не добавлено'}</p>
          <div className="seller-row"><span className="user-summary"><UserAvatar avatarUrl={product.seller.avatarUrl} name={product.seller.username} /><span>@{product.seller.username} · ★ {product.seller.rating.toFixed(1)} ({product.seller.reviewCount})</span></span><strong>{money(product.priceCents)}</strong></div>
        </button>
        <button className={`favorite ${product.favorite ? 'active' : ''}`} onClick={() => core.toggleFavorite(product)} aria-label={product.favorite ? 'Убрать из избранного' : 'В избранное'}>♥</button>
      </Card>)}</div>}
    <Modal open={Boolean(selected)} title={selected?.title || ''} onClose={() => setSelected(null)}>
      {selected && <div className="stack compact"><div className="product-detail"><Badge tone="success">{selected.status}</Badge><strong>{money(selected.priceCents)}</strong></div>
        <p className="muted">{selected.description || 'Продавец не добавил описание.'}</p>
        <Card><div className="seller-row"><div className="user-summary"><UserAvatar avatarUrl={selected.seller.avatarUrl} name={selected.seller.username} /><div><b>@{selected.seller.username}</b><p className="muted">{selected.seller.onixId} · {selected.seller.salesCount} сделок</p></div></div><span>★ {selected.seller.rating.toFixed(1)}</span></div>
          <Button variant="secondary" onClick={() => void core.toggleFollow(selected.seller.onixId, selected.seller.followed)}>+ Подписаться</Button></Card>
        <div className="modal__actions"><Button variant="secondary" onClick={async () => {
          if (await core.startChat(selected.seller.onixId)) switchTo('chat');
        }}>Написать</Button><Button disabled={selected.status !== 'ACTIVE'} onClick={() => setConfirm(selected)}>Купить</Button></div>
      </div>}
    </Modal>
    <Confirm open={Boolean(confirm)} title="Подтвердите покупку" text={confirm ? `${money(confirm.priceCents)} будут безопасно заморожены до получения товара.` : ''} busy={core.actionBusy?.startsWith('purchase')} onCancel={() => setConfirm(null)}
      onConfirm={async () => { if (confirm && await core.purchase(confirm.id)) { setConfirm(null); setSelected(null); setToast('Сделка создана. Деньги в сейфе.'); switchTo('deals'); } }} />
  </div>;
}

function ProductForm({ core, onDone, setToast }: { core: Core; onDone: () => void; setToast: (text: string) => void }) {
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = validateDraft(draft);
    setErrors(next);
    if (next.length) return;
    if (await core.createProduct(draft)) { setToast('Лот опубликован на витрине.'); setDraft(emptyDraft); onDone(); }
  };
  return <div className="stack narrow"><SectionHeader title="РАЗМЕСТИТЬ ЛОТ" subtitle="ОДНА ФОРМА · БЕЗ ЛИШНИХ ШАГОВ" />
    <Card><form className="form" onSubmit={submit}>
      {errors.length > 0 && <div className="form-error" role="alert"><strong>Проверьте данные:</strong>{errors.map(item => <span key={item}>— {item}</span>)}</div>}
      <Field label="Название"><Input required minLength={5} maxLength={80} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Например, Butterfly | Fade" /></Field>
      <Field label="Описание" hint="Не публикуйте пароли и контактные данные"><Textarea required maxLength={1500} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field>
      <div className="form-grid"><Field label="Категория"><Select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}>{CATEGORIES.map(item => <option key={item}>{item}</option>)}</Select></Field>
        <Field label="Подкатегория"><Input value={draft.subcategory} onChange={event => setDraft({ ...draft, subcategory: event.target.value })} /></Field></div>
      <div className="form-grid"><Field label="Цена, ₽"><Input required inputMode="decimal" value={draft.priceRubles} onChange={event => setDraft({ ...draft, priceRubles: event.target.value })} /></Field>
        <Field label="Количество"><Input required type="number" min={1} max={999} value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: Number(event.target.value) })} /></Field></div>
      <div className="summary-line"><span>К получению</span><strong>{draft.priceRubles && Number.isFinite(Number(draft.priceRubles)) ? `${Number(draft.priceRubles).toFixed(2)} ₽` : '—'}</strong></div>
      <Button type="submit" busy={core.actionBusy === 'product-form'}>ОПУБЛИКОВАТЬ ЛОТ</Button>
    </form></Card></div>;
}

function Deals({ core, setToast }: { core: Core; setToast: (text: string) => void }) {
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [confirm, setConfirm] = useState<{ deal: Deal; action: 'deliver' | 'complete' | 'dispute' } | null>(null);
  const [reviewDeal, setReviewDeal] = useState<Deal | null>(null);
  const deals = core.deals.filter(deal => deal.role === role);
  return <div className="stack"><SectionHeader title="ESCROW ГАРАНТ" subtitle="КОНТРОЛЬ ЗАМОРОЖЕННЫХ СДЕЛОК" />
    <div className="segmented">{(['buyer', 'seller'] as const).map(item => <button className={role === item ? 'active' : ''} key={item} onClick={() => setRole(item)}>{item === 'buyer' ? 'МОИ ПОКУПКИ' : 'МОИ ПРОДАЖИ'}</button>)}</div>
    {core.states.deals === 'loading' ? <Card><Skeleton lines={5} /></Card> : core.states.deals === 'error' ? <StateView title="Сделки не загрузились" text={core.errors.deals || ''} action={<Button onClick={core.refreshAll}>Повторить</Button>} /> :
      deals.length === 0 ? <StateView title="Здесь пока пусто" text={role === 'buyer' ? 'Купите товар — сделка появится здесь.' : 'Опубликуйте товар и дождитесь покупателя.'} /> :
      deals.map(deal => <Card key={deal.id} className="deal-card"><div className="seller-row"><div className="user-summary"><UserAvatar avatarUrl={deal.counterparty.avatarUrl} name={deal.counterparty.username} /><div><h2>{deal.product.title}</h2><p className="muted">@{deal.counterparty.username} // {deal.product.category}</p></div></div><strong>{money(deal.totalAmountCents)}</strong></div>
        <div className="deal-status"><span>ФАЗА</span><Badge tone={deal.status === 'COMPLETED' ? 'success' : deal.status === 'DISPUTE' ? 'danger' : 'warning'}>{dealLabels[deal.status]}</Badge></div>
        <ol className="timeline">{['Оплата', 'Hold', 'Передача', 'Выплата'].map((item, index) => <li className={dealProgress(deal.status) >= index ? 'done' : ''} key={item}>{item}</li>)}</ol>
        <div className="card-actions">{role === 'seller' && deal.status === 'PAYMENT_HOLD' && <Button onClick={() => setConfirm({ deal, action: 'deliver' })}>Товар передан</Button>}
          {role === 'buyer' && deal.status === 'DELIVERING' && <Button onClick={() => setConfirm({ deal, action: 'complete' })}>Товар получен</Button>}
          {!['COMPLETED', 'CANCELED', 'DISPUTE'].includes(deal.status) && <Button variant="danger" onClick={() => setConfirm({ deal, action: 'dispute' })}>Открыть спор</Button>}</div>
        {deal.status === 'COMPLETED' && deal.canReview && <Button variant="secondary" onClick={() => setReviewDeal(deal)}>Оставить отзыв</Button>}
      </Card>)}
    <Confirm open={Boolean(confirm)} dangerous={confirm?.action === 'dispute'} busy={core.actionBusy?.startsWith('deal-')} title={confirm?.action === 'complete' ? 'Выдать деньги продавцу?' : confirm?.action === 'dispute' ? 'Открыть спор?' : 'Подтвердить передачу?'}
      text={confirm?.action === 'complete' ? 'Это действие необратимо. Подтверждайте только после проверки товара.' : confirm?.action === 'dispute' ? 'Сделка будет остановлена и передана администратору.' : 'Покупатель получит уведомление о передаче.'}
      onCancel={() => setConfirm(null)} onConfirm={async () => { if (confirm && await core.dealAction(confirm.deal, confirm.action)) { setToast('Статус сделки обновлён.'); setConfirm(null); } }} />
    <ReviewForm deal={reviewDeal} core={core} onClose={() => setReviewDeal(null)} setToast={setToast} />
  </div>;
}

function dealProgress(status: Deal['status']) {
  return ({ PENDING: 0, PAYMENT_HOLD: 1, DELIVERING: 2, COMPLETED: 3, CANCELED: -1, DISPUTE: 1, REFUNDED: -1 })[status];
}

function ReviewForm({ deal, core, onClose, setToast }: { deal: Deal | null; core: Core; onClose: () => void; setToast: (text: string) => void }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  return <Modal open={Boolean(deal)} title="Отзыв о сделке" onClose={onClose}><form className="form" onSubmit={async event => { event.preventDefault(); if (deal && text.trim() && await core.submitReview(deal.id, rating, text)) { setText(''); setToast('Спасибо, отзыв опубликован.'); onClose(); } }}>
    <Field label="Оценка"><Select value={rating} onChange={event => setRating(Number(event.target.value))}>{[5,4,3,2,1].map(value => <option key={value} value={value}>{'★'.repeat(value)}</option>)}</Select></Field>
    <Field label="Комментарий"><Textarea required minLength={5} maxLength={500} value={text} onChange={event => setText(event.target.value)} /></Field>
    <div className="modal__actions"><Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit" busy={core.actionBusy === 'review'}>Опубликовать</Button></div>
  </form></Modal>;
}

function Chats({ core }: { core: Core }) {
  const [threadId, setThreadId] = useState('');
  const [text, setText] = useState('');
  const thread = core.chats.find(item => item.id === threadId);
  const messages = threadId ? core.messages[threadId] || [] : [];
  useEffect(() => { if (threadId) void core.loadMessages(threadId); }, [core.loadMessages, threadId]);
  if (core.states.chats === 'loading') return <Card><Skeleton lines={6} /></Card>;
  return <div className="chat-layout">
    <div className={`thread-list ${thread ? 'mobile-hidden' : ''}`}><SectionHeader title="ЧАТЫ" subtitle="СООБЩЕНИЯ И УВЕДОМЛЕНИЯ" />
      {core.states.chats === 'error' ? <StateView title="Чаты недоступны" text={core.errors.chats || ''} /> : core.chats.length === 0 ? <StateView title="Нет диалогов" text="Напишите продавцу из карточки товара." /> :
        core.chats.map(chat => <button className="thread" key={chat.id} onClick={() => setThreadId(chat.id)}><span><b>{chat.title}</b><small>{chat.subtitle || 'Открыть диалог'}</small></span>{chat.unreadCount > 0 && <em>{chat.unreadCount}</em>}</button>)}</div>
    <div className={`conversation ${!thread ? 'mobile-hidden' : ''}`}>{thread ? <><div className="conversation__head"><Button variant="ghost" className="back" onClick={() => setThreadId('')}>←</Button><div><b>{thread.title}</b><small>{thread.subtitle}</small></div></div>
      <div className="messages">{messages.length === 0 ? <StateView title="Начните разговор" text="Сообщения сделки хранятся внутри ONIX." /> : messages.map(message =>
        <div className={`message ${message.mine ? 'mine' : ''}`} key={message.id}><small>@{message.sender.username}</small><p>{message.text}</p><time>{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div>
      <form className="composer" onSubmit={async event => { event.preventDefault(); if (await core.sendMessage(thread.id, text)) setText(''); }}><Input value={text} onChange={event => setText(event.target.value)} maxLength={1000} placeholder="Сообщение..." aria-label="Сообщение" /><Button type="submit" disabled={!text.trim()} busy={core.actionBusy === `message-${thread.id}`}>➤</Button></form>
    </> : <StateView title="Выберите диалог" text="Переписка откроется здесь." />}</div>
  </div>;
}

function Profile({ core, switchTo, setToast }: { core: Core; switchTo: (screen: Screen) => void; setToast: (text: string) => void }) {
  const [section, setSection] = useState<'overview' | 'listings' | 'favorites' | 'notifications' | 'reviews' | 'admin'>('overview');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [amount, setAmount] = useState('');
  const profile = core.profile;
  if (core.states.profile === 'loading') return <Card><Skeleton lines={6} /></Card>;
  if (!profile) return <StateView title="Профиль недоступен" text={core.errors.profile || 'Войдите через Telegram.'} action={<Button onClick={core.refreshAll}>Обновить</Button>} />;
  const favoriteProducts = core.products.filter(product => product.favorite);
  const ownProducts = core.products.filter(product => product.seller.id === profile.id);
  const profileSections: Array<'overview' | 'listings' | 'favorites' | 'notifications' | 'reviews' | 'admin'> =
    profile.roles.includes('ADMIN') ? ['overview', 'listings', 'favorites', 'notifications', 'reviews', 'admin'] : ['overview', 'listings', 'favorites', 'notifications', 'reviews'];
  return <div className="stack"><Card className="profile-card"><UserAvatar avatarUrl={profile.avatarUrl} name={profile.username} size="medium" /><div className="profile-main"><h1>@{profile.username}</h1><p>{profile.onixId} · был(а) недавно</p><div className="stats"><span><b>★ {profile.rating.toFixed(1)}</b> рейтинг</span><span><b>{profile.salesCount}</b> сделок</span><span><b>{profile.followersCount}</b> подписчиков</span></div></div>
      <div className="balance"><small>БАЛАНС</small><strong>{money(profile.balanceCents)}</strong><Button variant="secondary" onClick={() => setWithdrawOpen(true)}>Вывести</Button></div></Card>
    <div className="chips profile-tabs">{profileSections.map(item =>
      <button className={section === item ? 'active' : ''} key={item} onClick={() => setSection(item)}>{({ overview: 'ИСТОРИЯ', listings: 'МОИ ТОВАРЫ', favorites: 'ИЗБРАННОЕ', notifications: 'УВЕДОМЛЕНИЯ', reviews: 'ОТЗЫВЫ', admin: 'ADMIN' })[item]}</button>)}</div>
    {section === 'overview' && <Card><h2>// ИСТОРИЯ БАЛАНСА</h2>{profile.walletHistory.length === 0 ? <p className="empty-inline">Операций пока нет.</p> : <div className="operations">{profile.walletHistory.map(item => <div key={item.id}><span><b>{item.type}</b><small>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</small></span><strong>{money(item.amountCents)}</strong></div>)}</div>}</Card>}
    {section === 'favorites' && (favoriteProducts.length === 0 ? <StateView title="Избранное пусто" text="Отмечайте товары сердцем на витрине." action={<Button onClick={() => switchTo('market')}>На рынок</Button>} /> :
      <div className="product-grid">{favoriteProducts.map(item => <Card key={item.id}><h2>{item.title}</h2><div className="seller-row"><span className="user-summary"><UserAvatar avatarUrl={item.seller.avatarUrl} name={item.seller.username} /><span>@{item.seller.username}</span></span><strong>{money(item.priceCents)}</strong></div></Card>)}</div>)}
    {section === 'listings' && (ownProducts.length === 0 ? <StateView title="У вас нет товаров" text="Создайте первый лот — он появится здесь." action={<Button onClick={() => switchTo('create')}>Создать лот</Button>} /> :
      <div className="product-grid">{ownProducts.map(item => <Card key={item.id}><Badge tone={item.status === 'ACTIVE' ? 'success' : 'warning'}>{item.status}</Badge><h2>{item.title}</h2><div className="seller-row"><strong>{money(item.priceCents)}</strong><Button variant="secondary" onClick={() => setEditing(item)}>Редактировать</Button></div></Card>)}</div>)}
    {section === 'notifications' && (core.notifications.length === 0 ? <StateView title="Нет уведомлений" text="Здесь появятся сообщения о товарах, сделках и отзывах." /> :
      core.notifications.map(item => <Card key={item.id} interactive={!item.read} className={item.read ? 'muted-card' : ''} onClick={() => {
        if (!item.read) void core.markNotificationRead(item.id);
      }}><Badge tone={item.read ? 'neutral' : 'warning'}>{item.read ? 'Прочитано' : 'Новое'}</Badge><h2>{item.title}</h2><p className="muted">{item.body}</p></Card>))}
    {section === 'reviews' && (core.reviews.length === 0 ? <StateView title="Отзывов пока нет" text="Отзывы можно оставить после завершённой сделки." /> :
      core.reviews.map(review => <Card key={review.id}><div className="seller-row"><b>@{review.author.username}</b><span>{'★'.repeat(review.rating)}</span></div><p className="muted">{review.text}</p></Card>))}
    {section === 'admin' && profile.roles.includes('ADMIN') && <Admin core={core} setToast={setToast} />}
    <EditProduct product={editing} core={core} onClose={() => setEditing(null)} setToast={setToast} />
    <Modal open={withdrawOpen} title="Вывод средств" onClose={() => setWithdrawOpen(false)}><div className="form"><p className="modal__text">Сумма и комиссия будут подтверждены сервером до списания.</p><Field label="Сумма, ₽"><Input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></Field><div className="modal__actions"><Button variant="secondary" onClick={() => setWithdrawOpen(false)}>Отмена</Button><Button busy={core.actionBusy === 'withdraw'} disabled={Number(amount) < 100} onClick={async () => { if (await core.withdraw(Number(amount))) { setWithdrawOpen(false); setToast('Заявка на вывод создана.'); } }}>Продолжить</Button></div></div></Modal>
  </div>;
}

function EditProduct({ product, core, onClose, setToast }: { product: Product | null; core: Core; onClose: () => void; setToast: (text: string) => void }) {
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  useEffect(() => {
    if (product) setDraft({ title: product.title, description: product.description || '', priceRubles: String(Number(product.priceCents) / 100), quantity: product.quantity, category: product.category, subcategory: product.subcategory || '' });
  }, [product]);
  return <Modal open={Boolean(product)} title="Редактировать товар" onClose={onClose}><form className="form" onSubmit={async event => { event.preventDefault(); if (product && validateDraft(draft).length === 0 && await core.updateProduct(product.id, draft)) { setToast('Изменения сохранены.'); onClose(); } }}>
    <Field label="Название"><Input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></Field>
    <Field label="Описание"><Textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field>
    <div className="form-grid"><Field label="Цена, ₽"><Input value={draft.priceRubles} onChange={event => setDraft({ ...draft, priceRubles: event.target.value })} /></Field><Field label="Количество"><Input type="number" min={1} value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: Number(event.target.value) })} /></Field></div>
    <div className="modal__actions"><Button type="button" variant="danger" busy={core.actionBusy === `archive-${product?.id}`} onClick={async () => {
      if (product && await core.archiveProduct(product.id)) { setToast('Лот снят с публикации.'); onClose(); }
    }}>Снять</Button><Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit" busy={core.actionBusy === 'product-form'}>Сохранить</Button></div>
  </form></Modal>;
}

function Admin({ core, setToast }: { core: Core; setToast: (text: string) => void }) {
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState<'ban' | 'unban' | null>(null);
  return <Card className="admin-card"><h2>// ADMIN · МОДЕРАЦИЯ</h2><p className="muted">Доступ показан только по роли, полученной от сервера.</p><Field label="ONIX ID пользователя"><Input value={userId} onChange={event => setUserId(event.target.value)} placeholder="ONIX-000007" /></Field><div className="card-actions"><Button variant="danger" disabled={!userId} onClick={() => setAction('ban')}>Заблокировать</Button><Button variant="secondary" disabled={!userId} onClick={() => setAction('unban')}>Разблокировать</Button></div>
    <Confirm open={Boolean(action)} dangerous={action === 'ban'} title={action === 'ban' ? 'Заблокировать пользователя?' : 'Снять блокировку?'} text="Операция будет записана в журнал администратора." busy={core.actionBusy?.startsWith('admin-')} onCancel={() => setAction(null)} onConfirm={async () => { if (action && await core.adminAction(action, userId)) { setAction(null); setToast('Действие администратора выполнено.'); } }} /></Card>;
}