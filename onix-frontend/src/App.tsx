import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import WebApp from '@twa-dev/sdk';
import { api, loginWithTelegram as legacyLoginWithTelegram, money, friendlyError, ApiError } from './api/client';
import {
  getWebsiteAuthProvider,
  getWebsiteLoginProvider,
  isWebsiteAuthV2,
  openTelegramBotLogin,
  startBotLogin,
  waitAndCompleteBotLogin,
  AuthV2ApiError,
} from './auth';
import { BotLoginError } from './auth/botLogin';
import {
  API_PATHS, BAN_REASON_OPTIONS, CATEGORIES, CATEGORY_LABELS, SUBCATEGORIES_BY_CATEGORY, SUBCATEGORY_LABELS,
  formatBanRemaining, formatLastSeen, refreshBanInfo, type BanInfo, type BanReasonCode, type Deal, type OrderListQuery,
  type OrderListStatus, type Product, type ProductDraft, type PublicProfile,
} from './api/contracts';
import OnixBackground from './components/OnixBackground';
import UserAvatar from './components/UserAvatar';
import { Badge, Button, Card, Confirm, Field, Input, Modal, Select, Skeleton, StateView, Textarea, Toast } from './design-system';
import { useOnixCore } from './hooks/useOnixCore';
import { validateDraft } from './utils/productValidation';
import './App.css';

type TelegramLoginPayload = Record<string, string | number>;

declare global {
  interface Window {
    onixTelegramAuth?: (user: TelegramLoginPayload) => Promise<void>;
    Telegram?: Record<string, unknown>;
    TelegramLoginWidget?: unknown;
  }
}

let reportTelegramLoginError: (message: string) => void = () => {};
let reportTelegramBan: (ban: BanInfo) => void = () => {};

function extractBanFromError(error: unknown): BanInfo | undefined {
  if (error instanceof AuthV2ApiError || error instanceof BotLoginError) {
    const ban = (error.details as { ban?: BanInfo } | undefined)?.ban;
    if (error.code === 'AUTH_ACCOUNT_LOCKED' && ban) return ban;
  }
  if (error instanceof ApiError) {
    const details = error.details as { ban?: BanInfo } | undefined;
    const ban = details?.ban;
    if (error.code === 'AUTH_ACCOUNT_LOCKED' && ban) return ban;
  }
  return undefined;
}

function registerOnixTelegramAuth() {
  if (window.onixTelegramAuth) return;
  window.onixTelegramAuth = async (user: TelegramLoginPayload) => {
    try {
      if (isWebsiteAuthV2()) {
        await getWebsiteAuthProvider().loginWithTelegram(user);
      } else {
        await legacyLoginWithTelegram(user);
      }
      location.reload();
    } catch (error) {
      const ban = extractBanFromError(error);
      if (ban) reportTelegramBan(ban);
      reportTelegramLoginError('Telegram вход не выполнен.');
    }
  };
}

registerOnixTelegramAuth();

type Screen = 'market' | 'deals' | 'create' | 'chat' | 'profile';
const TABS: Array<{ id: Screen; icon: string; label: string }> = [
  { id: 'market', icon: '🛒', label: 'РЫНОК' }, { id: 'deals', icon: '🔒', label: 'СДЕЛКИ' },
  { id: 'create', icon: '📦', label: 'ЛОТ' }, { id: 'chat', icon: '💬', label: 'ЧАТ' },
  { id: 'profile', icon: '◉', label: 'ПРОФИЛЬ' },
];

const emptyDraft: ProductDraft = {
  title: '', description: '', priceRubles: '', quantity: 1,
  category: CATEGORIES[0], subcategory: SUBCATEGORIES_BY_CATEGORY[CATEGORIES[0]][0],
  autoDeliver: false, deliveryText: '',
};
const dealLabels: Record<Deal['status'], string> = {
  PENDING: 'Ожидает оплаты', PAYMENT_HOLD: 'Деньги в сейфе', DELIVERING: 'Передача товара',
  COMPLETED: 'Завершено', CANCELED: 'Отменено', DISPUTE: 'Открыт спор', REFUNDED: 'Возвращено',
};

const DEAL_FILTERS: Array<{ id: string; label: string; status?: OrderListStatus }> = [
  { id: 'all', label: 'Все' },
  { id: 'open', label: 'Незавершённые', status: 'open' },
  { id: 'completed', label: 'Завершённые', status: 'completed' },
];

function isTelegramMiniApp() {
  try { return Boolean(WebApp.initData); } catch { return false; }
}

export default function App() {
  const core = useOnixCore();
  const [screen, setScreen] = useState<Screen>('market');
  const [direction, setDirection] = useState(1);
  const [toast, setToast] = useState('');
  const [banNotice, setBanNotice] = useState<BanInfo | undefined>();
  const [focusChatId, setFocusChatId] = useState<string | null>(null);
  const [focusProductId, setFocusProductId] = useState<string | null>(null);
  const [focusDealId, setFocusDealId] = useState<string | null>(null);
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
  useEffect(() => {
    reportTelegramBan = setBanNotice;
    return () => { reportTelegramBan = () => {}; };
  }, []);
  useEffect(() => {
    if (core.profile) setBanNotice(undefined);
  }, [core.profile]);
  useEffect(() => {
    if (core.banFromAuth) setBanNotice(core.banFromAuth);
  }, [core.banFromAuth]);
  useEffect(() => {
    if (!banNotice || banNotice.permanent) return;
    const tick = () => setBanNotice((prev) => (prev ? refreshBanInfo(prev) : prev));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [banNotice?.bannedUntil, banNotice?.permanent]);
  const onAuthenticated = () => {
    setBanNotice(undefined);
    core.refreshAll();
  };
  const openDirectChat = async (onixId: string) => {
    const thread = await core.startChat(onixId);
    if (!thread) return false;
    setFocusChatId(thread.id);
    switchTo('chat');
    return true;
  };
  const openProductCard = (productId: string) => {
    setFocusProductId(productId);
    switchTo('market');
  };
  const openDeal = (dealId: string) => {
    setFocusDealId(dealId);
    switchTo('deals');
  };
  const mode = screen === 'chat' ? 'chat' : screen === 'deals' || screen === 'create' ? 'focus' : 'normal';
  const unread = core.unread > 99 ? '99+' : String(core.unread);
  const showAuth = core.states.profile === 'error' || Boolean(banNotice);

  return <div className="app-shell">
    <OnixBackground mode={mode} />
    <a className="skip-link" href="#content">К содержимому</a>
    <header className="topbar">
      <div className="brand" aria-label="ONIX">O N I X</div>
      <div className="identity">
        {core.states.profile === 'loading' && !core.profile ? (
          <><strong>…</strong><span>// ЗАГРУЗКА</span></>
        ) : core.profile ? (
          <span className="user-summary identity-user">
            <UserAvatar avatarUrl={core.profile.avatarUrl} name={core.profile.username} />
            <strong>{money(core.profile.balanceCents)}</strong>
            <span>// @{core.profile.username} · {core.profile.onixId}</span>
          </span>
        ) : (
          <><strong>ГОСТЬ</strong><span>// БЕЗ СЕССИИ</span></>
        )}
      </div>
    </header>
    {showAuth && (
      <AuthNotice
        miniApp={isTelegramMiniApp()}
        message={core.errors.profile}
        ban={banNotice}
        onAuthenticated={onAuthenticated}
        onBan={setBanNotice}
      />
    )}
    <main id="content" className="viewport" style={{ '--direction': direction } as CSSProperties}>
      <div key={screen} className="screen-transition">
        {screen === 'market' && <Market
          core={core}
          switchTo={switchTo}
          setToast={setToast}
          focusProductId={focusProductId}
          onFocusProductHandled={() => setFocusProductId(null)}
          openDirectChat={openDirectChat}
          openProductCard={openProductCard}
          openDealChat={(chatId) => {
            setFocusChatId(chatId);
            switchTo('chat');
          }}
        />}
        {screen === 'deals' && <Deals
          core={core}
          switchTo={switchTo}
          setToast={setToast}
          focusDealId={focusDealId}
          onFocusDealHandled={() => setFocusDealId(null)}
          openDealChat={(chatId) => {
            setFocusChatId(chatId);
            switchTo('chat');
          }}
        />}
        {screen === 'create' && <ProductForm core={core} onDone={() => switchTo('market')} setToast={setToast} />}
        {screen === 'chat' && <Chats
          core={core}
          focusChatId={focusChatId}
          onFocusChatHandled={() => setFocusChatId(null)}
          openDirectChat={openDirectChat}
          openProductCard={openProductCard}
          openDeal={openDeal}
          setToast={setToast}
        />}
        {screen === 'profile' && <Profile
          core={core}
          switchTo={switchTo}
          setToast={setToast}
          openDirectChat={openDirectChat}
          openProductCard={openProductCard}
        />}
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

function staffBadgeFromRoles(roles: Array<'USER' | 'ADMIN' | 'SUPPORT'>): 'ADMIN' | 'SUPPORT' | undefined {
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('SUPPORT')) return 'SUPPORT';
  return undefined;
}

function StaffBadge({ badge }: { badge?: 'ADMIN' | 'SUPPORT' }) {
  if (!badge) return null;
  return <span className="badge badge--staff">{badge}</span>;
}

function MessageText({ text, onOpenOnix }: { text: string; onOpenOnix: (onixId: string) => void }) {
  const parts = text.split(/(ONIX-\d+)/gi);
  return <>{parts.map((part, index) => {
    if (/^ONIX-\d+$/i.test(part)) {
      const onixId = part.toUpperCase();
      return <button key={`${index}-${onixId}`} type="button" className="onix-id-link" onClick={() => onOpenOnix(onixId)}>{onixId}</button>;
    }
    return <span key={index}>{part}</span>;
  })}</>;
}

function AuthNotice({
  miniApp,
  message,
  ban,
  onAuthenticated,
  onBan,
}: {
  miniApp: boolean;
  message?: string;
  ban?: BanInfo;
  onAuthenticated: () => void;
  onBan?: (ban: BanInfo) => void;
}) {
  const live = ban ? refreshBanInfo(ban) : undefined;
  const title = live
    ? 'Аккаунт заблокирован'
    : miniApp ? 'Не удалось подтвердить Telegram' : 'Войдите через Telegram';
  const expired = Boolean(live && !live.permanent && (live.remainingMs ?? 0) <= 0);
  return <div className="auth-notice" role="alert"><div>
    <strong>{title}</strong>
    {live ? <>
      <span className="ban-notice__row">Причина: {live.reason}</span>
      {live.comment ? <span className="ban-notice__row">Комментарий: {live.comment}</span> : null}
      {live.permanent
        ? <span className="ban-notice__row">Постоянная блокировка.</span>
        : <>
          <span className="ban-notice__row">
            Дата окончания: {live.bannedUntil
              ? new Date(live.bannedUntil).toLocaleString('ru-RU')
              : '—'}
          </span>
          <span className="ban-notice__row">{formatBanRemaining(live)}</span>
        </>}
      {expired && <span className="ban-notice__row">Повторите вход — блокировка будет снята автоматически.</span>}
    </> : <span>{message || 'Авторизация нужна для сделок и сообщений.'}</span>}
  </div>
    {miniApp ? <Button variant="secondary" onClick={() => location.reload()}>Повторить</Button> :
      <WebsiteLoginEntry onAuthenticated={onAuthenticated} onBan={onBan} />}
  </div>;
}

function WebsiteLoginEntry({ onAuthenticated, onBan }: { onAuthenticated: () => void; onBan?: (ban: BanInfo) => void }) {
  const provider = getWebsiteLoginProvider();
  if (provider === 'widget') return <TelegramLogin onBan={onBan} />;
  return <BotTelegramLogin onAuthenticated={onAuthenticated} onBan={onBan} />;
}

function BotTelegramLogin({ onAuthenticated, onBan }: { onAuthenticated: () => void; onBan?: (ban: BanInfo) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const onLogin = async () => {
    setError('');
    setBusy(true);
    setHint('Откройте Telegram и подтвердите вход…');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const started = await startBotLogin(controller.signal);
      openTelegramBotLogin(started.deepLink, started.webDeepLink);
      await waitAndCompleteBotLogin(started.challengeId, { signal: controller.signal });
      setHint('');
      onAuthenticatedRef.current();
    } catch (e) {
      if (controller.signal.aborted) return;
      const ban = extractBanFromError(e);
      if (ban) onBan?.(ban);
      setError(e instanceof Error ? e.message : 'Не удалось войти через Telegram.');
      setHint('Оставайтесь на этой вкладке — после подтверждения в Telegram вход завершится сам.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return <div>
    <Button onClick={() => void onLogin()} disabled={busy}>
      {busy ? 'Ожидание Telegram…' : 'Войти через Telegram'}
    </Button>
    {hint && <small>{hint}</small>}
    {error && <small>{error}</small>}
  </div>;
}

function TelegramLogin({ onBan }: { onBan?: (ban: BanInfo) => void }) {
  const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;
  const [error, setError] = useState('');
  const [ban, setBan] = useState<BanInfo | undefined>();
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bot) return;
    const host = hostRef.current;
    if (!host) return;
    reportTelegramLoginError = setError;
    reportTelegramBan = (next) => { setBan(next); onBan?.(next); };
    registerOnixTelegramAuth();

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', bot.replace(/^@/, ''));
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-onauth', 'onixTelegramAuth(user)');
    const handleError = () => setError('Telegram Login Widget не загрузился.');
    script.addEventListener('error', handleError);
    host.appendChild(script);

    return () => {
      reportTelegramLoginError = () => {};
      reportTelegramBan = () => {};
      script.removeEventListener('error', handleError);
      script.remove();
      host.replaceChildren();
    };
  }, [bot, onBan]);
  if (!bot) return <span>Настройте VITE_TELEGRAM_BOT_USERNAME</span>;
  return <div><div ref={hostRef} />{ban && <small>{formatBanRemaining(ban)}</small>}{error && <small>{error}</small>}</div>;
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="section-head"><div><h1>// {title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function Market({
  core, switchTo, setToast, focusProductId, onFocusProductHandled, openDirectChat, openProductCard, openDealChat,
}: {
  core: Core;
  switchTo: (screen: Screen) => void;
  setToast: (text: string) => void;
  focusProductId: string | null;
  onFocusProductHandled: () => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  openProductCard: (productId: string) => void;
  openDealChat: (chatId: string) => void;
}) {
  const [selected, setSelected] = useState<Product | null>(null);
  const [confirm, setConfirm] = useState<Product | null>(null);
  const [sellerProfile, setSellerProfile] = useState<PublicProfile | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Все');
  const [subcategory, setSubcategory] = useState('');
  const [sort, setSort] = useState('new');
  const [items, setItems] = useState<Product[]>([]);
  const [marketState, setMarketState] = useState<'loading' | 'success' | 'error'>('loading');
  const [marketError, setMarketError] = useState<string | undefined>();

  const isDefaultView = query.trim() === '' && category === 'Все' && !subcategory && sort === 'new';
  const onixQuery = query.trim().match(/^ONIX-\d+$/i)?.[0]?.toUpperCase();
  const marketSubs = category !== 'Все'
    ? (SUBCATEGORIES_BY_CATEGORY[category as typeof CATEGORIES[number]] ?? [])
    : [];

  useEffect(() => {
    if (core.states.profile === 'loading') {
      setMarketState('loading');
      return;
    }
    if (!core.profile) {
      setItems([]);
      setMarketError(core.errors.profile || 'Войдите через Telegram, чтобы продолжить.');
      setMarketState('error');
      return;
    }

    if (!isDefaultView) return;

    if (core.states.products === 'loading' || core.states.products === 'idle') {
      setMarketState('loading');
      return;
    }
    if (core.states.products === 'error') {
      setItems([]);
      setMarketError(core.errors.products || 'Витрина недоступна');
      setMarketState('error');
      return;
    }
    setItems(core.products);
    setMarketError(undefined);
    setMarketState('success');
  }, [
    core.errors.products,
    core.errors.profile,
    core.products,
    core.profile,
    core.states.products,
    core.states.profile,
    isDefaultView,
  ]);

  useEffect(() => {
    if (core.states.profile === 'loading' || !core.profile) return;
    if (isDefaultView) return;

    const controller = new AbortController();
    const debounceMs = query.trim() ? 300 : 0;
    const timer = window.setTimeout(() => {
      setMarketState('loading');
      const serverSort = sort === 'price' ? 'price_asc' as const : sort === 'rating' ? 'rating' as const : 'newest' as const;
      void core.listProducts({
        search: query.trim() || undefined,
        category: category === 'Все' ? undefined : category,
        subcategory: subcategory || undefined,
        sort: serverSort,
        limit: 30,
        offset: 0,
      }, controller.signal).then((data) => {
        setItems(data);
        setMarketError(undefined);
        setMarketState('success');
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setItems([]);
        setMarketError(friendlyError(error));
        setMarketState('error');
      });
    }, debounceMs);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [category, core.listProducts, core.profile, core.states.profile, isDefaultView, query, sort, subcategory]);

  useEffect(() => {
    if (!selected) return;
    const fresh = items.find((item) => item.id === selected.id)
      ?? core.products.find((item) => item.id === selected.id);
    if (!fresh) return;
    if (
      fresh.seller.followed !== selected.seller.followed
      || fresh.seller.followersCount !== selected.seller.followersCount
      || fresh.favorite !== selected.favorite
    ) {
      setSelected(fresh);
    }
  }, [core.products, items, selected]);

  useEffect(() => {
    if (!focusProductId) return;
    let cancelled = false;
    void (async () => {
      try {
        const fromList = items.find((item) => item.id === focusProductId)
          ?? core.products.find((item) => item.id === focusProductId);
        const product = fromList
          ?? await api.get<Product>(`${API_PATHS.products}/${encodeURIComponent(focusProductId)}`);
        if (cancelled) return;
        setSellerProfile(null);
        setSelected(product);
      } catch { /* ignore */ }
      finally {
        if (!cancelled) onFocusProductHandled();
      }
    })();
    return () => { cancelled = true; };
  }, [core.products, focusProductId, items, onFocusProductHandled]);

  return <div className="stack">
    <div className="search-row"><Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Товар, продавец или ONIX ID" aria-label="Поиск" />
      <Select value={sort} onChange={event => setSort(event.target.value)} aria-label="Сортировка"><option value="new">Сначала новые</option><option value="price">Сначала дешевле</option><option value="rating">По рейтингу</option></Select></div>
    {onixQuery && <Button variant="secondary" onClick={async () => {
      try { setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixQuery))); } catch { /* ignore */ }
    }}>Открыть профиль</Button>}
    <div className="chips" role="list" aria-label="Категории">{['Все', ...CATEGORIES].map(item =>
      <button role="listitem" className={category === item ? 'active' : ''} key={item} onClick={() => {
        setCategory(item);
        setSubcategory('');
      }}>{item === 'Все' ? item.toUpperCase() : CATEGORY_LABELS[item as keyof typeof CATEGORY_LABELS].toUpperCase()}</button>)}</div>
    {marketSubs.length > 0 && <div className="chips" role="list" aria-label="Подкатегории">
      {marketSubs.map(item => (
        <button
          role="listitem"
          className={subcategory === item ? 'active' : ''}
          key={item}
          onClick={() => setSubcategory(subcategory === item ? '' : item)}
        >{(SUBCATEGORY_LABELS[item] ?? item).toUpperCase()}</button>
      ))}
    </div>}
    {marketState === 'loading' ? <div className="product-grid"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div> :
      marketState === 'error' ? <StateView title="Витрина недоступна" text={marketError || ''} action={<Button onClick={() => void core.refreshAll()}>Попробовать снова</Button>} /> :
      items.length === 0 ? <StateView title="Ничего не найдено" text="Измените запрос или фильтры. Можно разместить собственный лот." action={<Button onClick={() => switchTo('create')}>Разместить лот</Button>} /> :
      <div className="product-grid">{items.map(product => <Card key={product.id} interactive className="product-card">
        <button className="product-main" onClick={() => setSelected(product)} aria-label={`Открыть ${product.title}`}>
          <div className="product-card__top"><Badge tone={product.status === 'ACTIVE' ? 'success' : 'warning'}>{product.status}</Badge><span>{product.category}</span></div>
          <h2>{product.title}</h2><p>{product.description || 'Описание не добавлено'}</p>
          <div className="seller-row"><span className="user-summary"><UserAvatar avatarUrl={product.seller.avatarUrl} name={product.seller.username} /><span>@{product.seller.username} <StaffBadge badge={product.seller.badge} /> · ★ {product.seller.rating.toFixed(1)} ({product.seller.reviewCount})</span></span><strong>{money(product.priceCents)}</strong></div>
        </button>
        <button className={`favorite ${product.favorite ? 'active' : ''}`} onClick={() => {
          setItems(previous => previous.map(item => item.id === product.id ? { ...item, favorite: !item.favorite } : item));
          void core.toggleFavorite(product);
        }} aria-label={product.favorite ? 'Убрать из избранного' : 'В избранное'}>♥</button>
      </Card>)}</div>}
    <Modal open={Boolean(selected)} title={selected?.title || ''} onClose={() => setSelected(null)}>
      {selected && <div className="stack compact"><div className="product-detail"><Badge tone="success">{selected.status}</Badge><strong>{money(selected.priceCents)}</strong></div>
        <p className="muted">{selected.description || 'Продавец не добавил описание.'}</p>
        <Card><div className="seller-row"><div className="user-summary"><UserAvatar avatarUrl={selected.seller.avatarUrl} name={selected.seller.username} /><div><b>@{selected.seller.username} <StaffBadge badge={selected.seller.badge} /></b><p className="muted">{selected.seller.onixId} · {selected.seller.salesCount} сделок · {selected.seller.followersCount} подписчиков · {formatLastSeen(selected.seller.lastOnline)}</p></div></div><span>★ {selected.seller.rating.toFixed(1)}</span></div>
          <div className="card-actions">
            <Button variant="secondary" onClick={async () => {
              try { setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(selected.seller.onixId))); } catch { /* ignore */ }
            }}>Профиль продавца</Button>
            <Button
              variant="secondary"
              busy={core.actionBusy === `follow-${selected.seller.onixId}`}
              onClick={() => {
                setItems((previous) => previous.map((item) => (
                  item.seller.onixId === selected.seller.onixId
                    ? {
                      ...item,
                      seller: {
                        ...item.seller,
                        followed: !selected.seller.followed,
                        followersCount: Math.max(0, item.seller.followersCount + (selected.seller.followed ? -1 : 1)),
                      },
                    }
                    : item
                )));
                void core.toggleFollow(selected.seller.onixId, Boolean(selected.seller.followed));
              }}
            >{selected.seller.followed ? 'Отписаться' : '+ Подписаться'}</Button>
          </div></Card>
        <div className="modal__actions"><Button variant="secondary" onClick={async () => {
          setSelected(null);
          await openDirectChat(selected.seller.onixId);
        }}>Написать</Button><Button disabled={selected.status !== 'ACTIVE'} onClick={() => setConfirm(selected)}>Купить</Button></div>
      </div>}
    </Modal>
    <PublicProfileModal
      profile={sellerProfile}
      onClose={() => setSellerProfile(null)}
      core={core}
      onOpenOnix={async (onixId) => {
        if (sellerProfile?.onixId === onixId) return;
        try { setSellerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixId))); } catch { /* ignore */ }
      }}
      onWrite={async (onixId) => {
        setSellerProfile(null);
        await openDirectChat(onixId);
      }}
      onOpenProduct={(productId) => {
        setSellerProfile(null);
        openProductCard(productId);
      }}
      setToast={setToast}
    />
    <Confirm open={Boolean(confirm)} title="Подтвердите покупку" text={confirm ? `${money(confirm.priceCents)} будут безопасно заморожены до получения товара.` : ''} busy={core.actionBusy?.startsWith('purchase')} onCancel={() => setConfirm(null)}
      onConfirm={async () => {
        if (!confirm) return;
        const deal = await core.purchase(confirm.id);
        if (!deal) return;
        setConfirm(null);
        setSelected(null);
        setToast('Сделка создана. Деньги в сейфе.');
        if (deal.chatId) openDealChat(deal.chatId);
        else switchTo('deals');
      }} />
  </div>;
}

function ProductForm({ core, onDone, setToast }: { core: Core; onDone: () => void; setToast: (text: string) => void }) {
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const subs = SUBCATEGORIES_BY_CATEGORY[draft.category as typeof CATEGORIES[number]] ?? SUBCATEGORIES_BY_CATEGORY.OTHER;
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
      {core.errors['product-form'] && <div className="form-error" role="alert"><strong>{core.errors['product-form']}</strong></div>}
      <Field label="Название"><Input required minLength={5} maxLength={80} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Например, Butterfly | Fade" /></Field>
      <Field label="Описание" hint="Не публикуйте пароли в описании — используйте автовыдачу"><Textarea required maxLength={1500} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field>
      <Field label="Категория"><Select value={draft.category} onChange={event => {
        const category = event.target.value;
        const nextSubs = SUBCATEGORIES_BY_CATEGORY[category as typeof CATEGORIES[number]] ?? SUBCATEGORIES_BY_CATEGORY.OTHER;
        setDraft({ ...draft, category, subcategory: nextSubs[0] });
      }}>{CATEGORIES.map(item => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}</Select></Field>
      <Field label="Подкатегория">
        <div className="chips" role="list" aria-label="Подкатегории">
          {subs.map(item => (
            <button
              type="button"
              role="listitem"
              className={draft.subcategory === item ? 'active' : ''}
              key={item}
              onClick={() => setDraft({ ...draft, subcategory: item })}
            >{(SUBCATEGORY_LABELS[item] ?? item).toUpperCase()}</button>
          ))}
        </div>
      </Field>
      <div className="form-grid"><Field label="Цена, ₽"><Input required inputMode="decimal" value={draft.priceRubles} onChange={event => setDraft({ ...draft, priceRubles: event.target.value })} /></Field>
        <Field label="Количество"><Input required type="number" min={1} max={999} value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: Number(event.target.value) })} /></Field></div>
      <label className="check-row"><input type="checkbox" checked={Boolean(draft.autoDeliver)} onChange={event => setDraft({ ...draft, autoDeliver: event.target.checked })} /> Автоматическая выдача</label>
      {draft.autoDeliver && <Field label="Текст товара" hint="login / password / код / ссылка — выдаётся только после оплаты"><Textarea required maxLength={4000} value={draft.deliveryText || ''} onChange={event => setDraft({ ...draft, deliveryText: event.target.value })} /></Field>}
      <div className="summary-line"><span>К получению</span><strong>{draft.priceRubles && Number.isFinite(Number(draft.priceRubles)) ? `${Number(draft.priceRubles).toFixed(2)} ₽` : '—'}</strong></div>
      <Button type="submit" busy={core.actionBusy === 'product-form'}>ОПУБЛИКОВАТЬ ЛОТ</Button>
    </form></Card></div>;
}

function Deals({
  core, switchTo, setToast, focusDealId, onFocusDealHandled, openDealChat,
}: {
  core: Core;
  switchTo: (screen: Screen) => void;
  setToast: (text: string) => void;
  focusDealId: string | null;
  onFocusDealHandled: () => void;
  openDealChat: (chatId: string) => void;
}) {
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [dealFilter, setDealFilter] = useState('all');
  const [confirm, setConfirm] = useState<{ deal: Deal; action: 'deliver' | 'complete' | 'dispute' } | null>(null);
  const [reviewDeal, setReviewDeal] = useState<Deal | null>(null);
  const [refundDeal, setRefundDeal] = useState<Deal | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [highlightedDealId, setHighlightedDealId] = useState<string | null>(null);
  const activeFilter = DEAL_FILTERS.find(item => item.id === dealFilter) ?? DEAL_FILTERS[0];
  const listQuery: OrderListQuery = {
    ...(activeFilter.status ? { status: activeFilter.status } : {}),
  };
  const skipBootstrappedAll = useRef(true);
  useEffect(() => {
    if (!core.profile) return;
    // Bootstrap already loaded GET /orders — skip duplicate on first Deals mount with filter=all.
    if (dealFilter === 'all' && skipBootstrappedAll.current) {
      skipBootstrappedAll.current = false;
      return;
    }
    skipBootstrappedAll.current = false;
    void core.listDeals(listQuery);
  }, [core.listDeals, core.profile, dealFilter]);
  useEffect(() => {
    if (!focusDealId) return;
    setDealFilter('all');
    setHighlightedDealId(focusDealId);
    const deal = core.deals.find((item) => item.id === focusDealId);
    if (deal) setRole(deal.role);
    onFocusDealHandled();
  }, [core.deals, focusDealId, onFocusDealHandled]);
  const deals = core.deals.filter(deal => deal.role === role);
  const isSupport = Boolean(core.profile?.roles.includes('SUPPORT') || core.profile?.roles.includes('ADMIN'));
  return <div className="stack"><SectionHeader title="ESCROW ГАРАНТ" subtitle="КОНТРОЛЬ ЗАМОРОЖЕННЫХ СДЕЛОК" />
    <div className="chips" role="list" aria-label="Фильтры сделок">{DEAL_FILTERS.map(item =>
      <button role="listitem" className={dealFilter === item.id ? 'active' : ''} key={item.id} onClick={() => setDealFilter(item.id)}>{item.label.toUpperCase()}</button>)}</div>
    <div className="segmented">{(['buyer', 'seller'] as const).map(item => <button className={role === item ? 'active' : ''} key={item} onClick={() => setRole(item)}>{item === 'buyer' ? 'МОИ ПОКУПКИ' : 'МОИ ПРОДАЖИ'}</button>)}</div>
    {core.states.deals === 'loading' ? <Card><Skeleton lines={5} /></Card> : core.states.deals === 'error' ? <StateView title="Сделки не загрузились" text={core.errors.deals || ''} action={<Button onClick={core.refreshAll}>Повторить</Button>} /> :
      deals.length === 0 ? <StateView title="Здесь пока пусто" text={role === 'buyer' ? 'Купите товар — сделка появится здесь.' : 'Опубликуйте товар и дождитесь покупателя.'} /> :
      deals.map(deal => <Card key={deal.id} className={`deal-card${highlightedDealId === deal.id ? ' deal-card--focus' : ''}`}><div className="seller-row"><div className="user-summary"><UserAvatar avatarUrl={deal.counterparty.avatarUrl} name={deal.counterparty.username} /><div><h2>{deal.product.title}</h2><p className="muted">@{deal.counterparty.username} <StaffBadge badge={deal.counterparty.badge} /> // {deal.product.category}</p></div></div><strong>{money(deal.totalAmountCents)}</strong></div>
        <div className="deal-status"><span>ФАЗА</span><Badge tone={deal.status === 'COMPLETED' ? 'success' : deal.status === 'DISPUTE' ? 'danger' : 'warning'}>{dealLabels[deal.status]}</Badge></div>
        <ol className="timeline">{['Оплата', 'Hold', 'Передача', 'Выплата'].map((item, index) => <li className={dealProgress(deal.status) >= index ? 'done' : ''} key={item}>{item}</li>)}</ol>
        <div className="card-actions">{role === 'seller' && deal.status === 'PAYMENT_HOLD' && <Button onClick={() => setConfirm({ deal, action: 'deliver' })}>Товар передан</Button>}
          {role === 'buyer' && deal.status === 'DELIVERING' && <Button onClick={() => setConfirm({ deal, action: 'complete' })}>Товар получен</Button>}
          {!['COMPLETED', 'CANCELED', 'DISPUTE', 'REFUNDED'].includes(deal.status) && <Button variant="danger" onClick={() => setConfirm({ deal, action: 'dispute' })}>Открыть спор</Button>}
          {role === 'seller' && !['REFUNDED', 'CANCELED'].includes(deal.status) && <Button variant="secondary" onClick={() => { setRefundDeal(deal); setRefundReason(''); }}>Возврат</Button>}
          <Button variant="secondary" busy={core.actionBusy === `support-${deal.id}`} onClick={async () => {
            const ticket = await core.openSupport(deal.id);
            if (!ticket) return;
            setToast('Обращение создано. Поддержка в чате.');
            if (ticket.chatId) openDealChat(ticket.chatId);
            else if (deal.chatId) openDealChat(deal.chatId);
            else switchTo('chat');
          }}>Обратиться в поддержку</Button>
          {isSupport && !['REFUNDED', 'CANCELED'].includes(deal.status) && <Button variant="danger" busy={core.actionBusy === `refund-${deal.id}`} onClick={async () => {
            if (await core.supportRefund(deal.id, 'Возврат поддержкой')) setToast('Возврат через Escrow выполнен.');
          }}>Refund</Button>}
        </div>
        {deal.status === 'COMPLETED' && deal.canReview && <Button variant="secondary" onClick={() => setReviewDeal(deal)}>Оставить отзыв</Button>}
      </Card>)}
    <Confirm open={Boolean(confirm)} dangerous={confirm?.action === 'dispute'} busy={core.actionBusy?.startsWith('deal-')} title={confirm?.action === 'complete' ? 'Выдать деньги продавцу?' : confirm?.action === 'dispute' ? 'Открыть спор?' : 'Подтвердить передачу?'}
      text={confirm?.action === 'complete' ? 'Это действие необратимо. Подтверждайте только после проверки товара.' : confirm?.action === 'dispute' ? 'Сделка будет остановлена и передана администратору.' : 'Покупатель получит уведомление о передаче.'}
      onCancel={() => setConfirm(null)} onConfirm={async () => { if (confirm && await core.dealAction(confirm.deal, confirm.action)) { setToast('Статус сделки обновлён.'); setConfirm(null); } }} />
    <Modal open={Boolean(refundDeal)} title="Запрос возврата" onClose={() => setRefundDeal(null)}><div className="form">
      <Field label="Причина возврата"><Textarea required maxLength={500} value={refundReason} onChange={event => setRefundReason(event.target.value)} /></Field>
      <div className="modal__actions"><Button variant="secondary" onClick={() => setRefundDeal(null)}>Отмена</Button><Button busy={core.actionBusy === `seller-refund-${refundDeal?.id}`} disabled={!refundReason.trim()} onClick={async () => {
        if (refundDeal && refundReason.trim() && await core.sellerRefund(refundDeal.id, refundReason.trim())) { setRefundDeal(null); setToast('Запрос на возврат отправлен.'); }
      }}>Отправить</Button></div>
    </div></Modal>
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

function Chats({
  core, focusChatId, onFocusChatHandled, openDirectChat, openProductCard, openDeal, setToast,
}: {
  core: Core;
  focusChatId: string | null;
  onFocusChatHandled: () => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  openProductCard: (productId: string) => void;
  openDeal: (dealId: string) => void;
  setToast: (text: string) => void;
}) {
  const [threadId, setThreadId] = useState('');
  const [text, setText] = useState('');
  const [peerProfile, setPeerProfile] = useState<PublicProfile | null>(null);
  const [reportOnixId, setReportOnixId] = useState<string | null>(null);
  const thread = core.chats.find(item => item.id === threadId);
  const messages = threadId ? core.messages[threadId] || [] : [];
  const openOnixProfile = async (onixId: string) => {
    if (peerProfile?.onixId === onixId) return;
    try { setPeerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixId))); } catch { /* ignore */ }
  };
  useEffect(() => { if (threadId) void core.loadMessages(threadId); }, [core.loadMessages, threadId]);
  useEffect(() => {
    if (!focusChatId) return;
    setThreadId(focusChatId);
    onFocusChatHandled();
  }, [focusChatId, onFocusChatHandled]);
  if (core.states.chats === 'loading') return <Card><Skeleton lines={6} /></Card>;
  return <div className="chat-layout">
    <div className={`thread-list ${thread ? 'mobile-hidden' : ''}`}><SectionHeader title="ЧАТЫ" subtitle="СООБЩЕНИЯ СДЕЛОК" />
      {core.states.chats === 'error' ? <StateView title="Чаты недоступны" text={core.errors.chats || ''} /> : core.chats.length === 0 ? <StateView title="Нет диалогов" text="Напишите продавцу из карточки товара." /> :
        core.chats.map(chat => <button className="thread" key={chat.id} onClick={() => setThreadId(chat.id)}>
          <span className="thread-peer"><UserAvatar avatarUrl={chat.peerAvatarUrl} name={chat.title} /><span><b>{chat.title} <StaffBadge badge={chat.peerBadge} /></b><small>{chat.subtitle || 'Открыть диалог'}</small></span></span>
          {chat.unreadCount > 0 && <em>{chat.unreadCount}</em>}
        </button>)}</div>
    <div className={`conversation ${!thread ? 'mobile-hidden' : ''}`}>{thread ? <><div className="conversation__head"><Button variant="ghost" className="back" onClick={() => setThreadId('')}>←</Button>
      {thread.peerAvatarUrl !== undefined || thread.title ? <UserAvatar avatarUrl={thread.peerAvatarUrl} name={thread.title} /> : null}
      <div>
      <button type="button" className="linkish" onClick={async () => {
        if (!thread.peerOnixId) return;
        if (peerProfile?.onixId === thread.peerOnixId) return;
        try { setPeerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(thread.peerOnixId))); } catch { /* ignore */ }
      }}><b>{thread.title} <StaffBadge badge={thread.peerBadge} /></b></button>
      <small>{formatLastSeen(thread.peerLastOnline)}</small></div>
      {thread.peerOnixId && core.profile?.onixId !== thread.peerOnixId && (
        <Button variant="ghost" onClick={() => setReportOnixId(thread.peerOnixId!)}>Пожаловаться</Button>
      )}
      </div>
      {thread.orderCard && <div className="order-card-inline" role="region" aria-label="Карточка заказа">
        <div><small>Заказ #{thread.orderCard.id}</small><b>{thread.orderCard.productTitle}</b>
          <span>{money(thread.orderCard.totalAmountCents)} · {dealLabels[thread.orderCard.status]} · Escrow</span></div>
        <Button variant="secondary" onClick={() => openDeal(thread.dealId || thread.orderCard!.id)}>Открыть заказ</Button>
      </div>}
      <div className="messages">{messages.length === 0 ? <StateView title="Начните разговор" text="Сообщения сделки хранятся внутри ONIX." /> : messages.map(message =>
        <div className={`message-row ${message.mine ? 'mine' : ''} ${message.kind === 'SYSTEM' ? 'system' : ''}`} key={message.id}>
          {!message.mine && <UserAvatar avatarUrl={message.kind === 'SYSTEM' ? undefined : message.sender.avatarUrl} name={message.sender.username} />}
          <div className={`message ${message.mine ? 'mine' : ''} ${message.kind === 'SYSTEM' ? 'system' : ''}`}>
            {message.kind !== 'SYSTEM' && <small>@{message.sender.username} <StaffBadge badge={message.sender.badge} /></small>}
            {message.kind === 'SYSTEM' && <small>🛡 ONIX</small>}
            <p><MessageText text={message.text} onOpenOnix={openOnixProfile} /></p>
            {message.kind === 'SYSTEM' && message.text.includes('Заказ создан') && (() => {
              const orderId = message.text.match(/Заказ #(\d+)/)?.[1]
                || thread.dealId
                || thread.orderCard?.id;
              if (!orderId) return null;
              return <Button variant="secondary" onClick={() => openDeal(orderId)}>Открыть заказ</Button>;
            })()}
            <time>{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
        </div>)}</div>
      <form className="composer" onSubmit={async event => { event.preventDefault(); if (await core.sendMessage(thread.id, text)) setText(''); }}><Input value={text} onChange={event => setText(event.target.value)} maxLength={1000} placeholder="Сообщение..." aria-label="Сообщение" /><Button type="submit" disabled={!text.trim()} busy={core.actionBusy === `message-${thread.id}`}>➤</Button></form>
    </> : <StateView title="Выберите диалог" text="Переписка откроется здесь." />}</div>
    <PublicProfileModal
      profile={peerProfile}
      onClose={() => setPeerProfile(null)}
      core={core}
      onOpenOnix={openOnixProfile}
      onWrite={async (onixId) => {
        setPeerProfile(null);
        await openDirectChat(onixId);
      }}
      onOpenProduct={(productId) => {
        setPeerProfile(null);
        openProductCard(productId);
      }}
      onReport={(onixId) => setReportOnixId(onixId)}
      setToast={setToast}
    />
    <ReportUserModal
      onixId={reportOnixId}
      core={core}
      onClose={() => setReportOnixId(null)}
      setToast={setToast}
    />
  </div>;
}

function PublicProfileModal({
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
  useEffect(() => {
    if (!profile) return;
    setFollowed(Boolean(profile.followed));
    setFollowersCount(profile.followersCount);
    setSection('products');
    setReportOpen(false);
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

function ReportUserModal({
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

function Profile({
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
    {section === 'admin' && profile.roles.includes('ADMIN') && <Admin core={core} setToast={setToast} />}
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

function EditProduct({ product, core, onClose, setToast }: { product: Product | null; core: Core; onClose: () => void; setToast: (text: string) => void }) {
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

function Admin({ core, setToast }: { core: Core; setToast: (text: string) => void }) {
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState<BanReasonCode | ''>('');
  const [comment, setComment] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [confirmBan, setConfirmBan] = useState(false);
  const [confirmUnban, setConfirmUnban] = useState(false);
  const reasonOption = BAN_REASON_OPTIONS.find(item => item.value === reason);
  const banReady = Boolean(userId.trim() && reason && comment.trim() && (reason !== 'OTHER' || Number(durationDays) > 0));
  return <Card className="admin-card"><h2>// ADMIN · МОДЕРАЦИЯ</h2><p className="muted">Доступ показан только по роли, полученной от сервера.</p>
    <Field label="ONIX ID пользователя"><Input value={userId} onChange={event => setUserId(event.target.value)} placeholder="ONIX-000007" /></Field>
    <Field label="Причина блокировки" hint={reasonOption?.hint}>
      <Select value={reason} onChange={event => setReason(event.target.value as BanReasonCode | '')}>
        <option value="">Выберите причину</option>
        {BAN_REASON_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </Select>
    </Field>
    {reason === 'OTHER' && <Field label="Срок, дней"><Input type="number" min={1} value={durationDays} onChange={event => setDurationDays(event.target.value)} /></Field>}
    <Field label="Комментарий"><Textarea required maxLength={500} value={comment} onChange={event => setComment(event.target.value)} /></Field>
    <div className="card-actions">
      <Button variant="danger" disabled={!banReady} onClick={() => setConfirmBan(true)}>Заблокировать</Button>
      <Button variant="secondary" disabled={!userId.trim()} onClick={() => setConfirmUnban(true)}>Разблокировать</Button>
    </div>
    <Confirm open={confirmBan} dangerous title="Заблокировать пользователя?" text="Операция будет записана в журнал администратора." busy={core.actionBusy === 'admin-ban'} onCancel={() => setConfirmBan(false)} onConfirm={async () => {
      if (reason && comment.trim() && await core.adminAction('ban', userId.trim(), {
        reason,
        comment: comment.trim(),
        ...(reason === 'OTHER' && durationDays ? { durationDays: Number(durationDays) } : {}),
      })) { setConfirmBan(false); setToast('Действие администратора выполнено.'); }
    }} />
    <Confirm open={confirmUnban} title="Снять блокировку?" text="Пользователь снова сможет войти в ONIX." busy={core.actionBusy === 'admin-unban'} onCancel={() => setConfirmUnban(false)} onConfirm={async () => {
      if (await core.adminAction('unban', userId.trim())) { setConfirmUnban(false); setToast('Действие администратора выполнено.'); }
    }} />
  </Card>;
}