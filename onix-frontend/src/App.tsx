import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { money } from './api/client';
import { CATEGORIES, CATEGORY_LABELS, refreshBanInfo, type BanInfo, type Notification, type Product } from './api/contracts';
import { isTelegramMiniApp, telegramImpact } from './auth/telegramEnv';
import UserAvatar from './components/UserAvatar';
import {
  BrandMark,
  IconBell,
  IconChat,
  IconDeals,
  IconLot,
  IconMarket,
  IconMoon,
  IconProfile,
  IconSearch,
  IconSun,
  IconWallet,
} from './components/NavIcons';
import { Button, Card, Skeleton, Toast } from './design-system';
import { useOnixCore } from './hooks/useOnixCore';
import type { Screen } from './screens/types';
import './App.css';

const OnixBackground = lazy(() => import('./components/OnixBackground'));
const AuthNotice = lazy(() => import('./screens/AuthGate'));
const Market = lazy(() => import('./screens/Market'));
const Deals = lazy(() => import('./screens/Deals'));
const ProductForm = lazy(() => import('./screens/ProductForm'));
const Chats = lazy(() => import('./screens/Chats'));
const Profile = lazy(() => import('./screens/Profile'));

const LEFT_W_KEY = 'onix-sidebar-left-w';
const RIGHT_W_KEY = 'onix-sidebar-right-w';
const LEFT_MIN = 72;
const LEFT_DEFAULT = 272;
const RIGHT_MIN = 64;
const RIGHT_DEFAULT = 320;
const RIGHT_ICONS_AT = 88;
const LEFT_ICONS_AT = 96;
const TABS: Array<{ id: Screen; label: string; icon: ReactNode }> = [
  { id: 'market', label: 'Market', icon: <IconMarket /> },
  { id: 'deals', label: 'Deals', icon: <IconDeals /> },
  { id: 'create', label: 'Lot', icon: <IconLot /> },
  { id: 'chat', label: 'Chat', icon: <IconChat /> },
  { id: 'profile', label: 'Profile', icon: <IconProfile /> },
];

const SIDEBAR_NAV: Array<{ id: Screen; label: string; icon: ReactNode }> = [
  { id: 'market', label: 'Market', icon: <IconMarket /> },
  { id: 'deals', label: 'My Orders', icon: <IconDeals /> },
  { id: 'profile', label: 'Profile', icon: <IconProfile /> },
  { id: 'chat', label: 'Messages', icon: <IconChat /> },
  { id: 'create', label: 'Sell Account', icon: <IconLot /> },
];

const CAT_STYLE: Record<string, { bg: string; glow: string; letter: string }> = {
  STANDOFF_2: { bg: 'linear-gradient(145deg,#E8B93E,#C4982E)', glow: 'rgba(232,185,62,.35)', letter: 'S2' },
  STEAM: { bg: 'linear-gradient(145deg,#4A8FE0,#346FB8)', glow: 'rgba(74,143,224,.32)', letter: 'ST' },
  ROBLOX: { bg: 'linear-gradient(145deg,#5B8DEF,#3D6FD4)', glow: 'rgba(91,141,239,.32)', letter: 'RB' },
  RP_PROJECTS: { bg: 'linear-gradient(145deg,#8B7FF5,#6B5FE0)', glow: 'rgba(139,127,245,.32)', letter: 'RP' },
  BRAWL_STARS: { bg: 'linear-gradient(145deg,#E8934A,#C47535)', glow: 'rgba(232,147,74,.32)', letter: 'BS' },
  OTHER: { bg: 'linear-gradient(145deg,#8A8B96,#63646E)', glow: 'rgba(138,139,150,.28)', letter: '··' },
};

function formatLotCount(n: number): string {
  if (n <= 0) return '·';
  if (n > 99) return '99+';
  return String(n);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'сейчас';
  if (minutes < 60) return `${minutes}м`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}ч`;
  return `${Math.floor(hours / 24)}д`;
}

function ScreenFallback() {
  return <div className="stack"><div className="product-grid"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div></div>;
}

function readStoredWidth(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* ignore */ }
  return fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

const THEME_KEY = 'onix-theme';
type ThemeMode = 'dark' | 'light';

function readStoredTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  return null;
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* ignore */ }
}

function syncThemeFromTelegram(): ThemeMode {
  const stored = readStoredTheme();
  if (stored) {
    applyTheme(stored);
    return stored;
  }
  try {
    const root = globalThis as typeof globalThis & {
      Telegram?: { WebApp?: { themeParams?: { bg_color?: string; text_color?: string }; colorScheme?: string } };
    };
    const tg = root.Telegram?.WebApp;
    const scheme = tg?.colorScheme;
    if (scheme === 'light' || scheme === 'dark') {
      applyTheme(scheme);
      return scheme;
    }
    const bg = tg?.themeParams?.bg_color;
    if (bg) {
      const hex = bg.replace('#', '');
      const n = parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const next: ThemeMode = luma > 0.55 ? 'light' : 'dark';
      applyTheme(next);
      return next;
    }
  } catch { /* ignore */ }
  applyTheme('dark');
  return 'dark';
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
  const [headerBlur, setHeaderBlur] = useState(0);
  const [marketCategory, setMarketCategory] = useState<string>('Все');
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme() ?? 'dark');
  const [openWalletTopup, setOpenWalletTopup] = useState(false);
  const [leftW, setLeftW] = useState(() => readStoredWidth(LEFT_W_KEY, LEFT_DEFAULT));
  const [rightW, setRightW] = useState(() => readStoredWidth(RIGHT_W_KEY, RIGHT_DEFAULT));

  const leftIcons = leftW <= LEFT_ICONS_AT;
  const rightIcons = rightW <= RIGHT_ICONS_AT;

  const startResize = useCallback((side: 'left' | 'right', event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = side === 'left' ? leftW : rightW;
    const target = event.currentTarget;
    const shell = target.closest('.app-shell') as HTMLElement | null;
    target.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-sidebar');

    let latest = startW;
    let raf = 0;

    const applyWidth = (next: number) => {
      latest = next;
      if (!shell) return;
      if (side === 'left') shell.style.setProperty('--sidebar-left-w', `${next}px`);
      else shell.style.setProperty('--sidebar-right-w', `${next}px`);
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const max = side === 'left'
        ? Math.floor(window.innerWidth * 0.8)
        : Math.floor(window.innerWidth * 0.45);
      const next = clamp(
        side === 'left' ? startW + dx : startW - dx,
        side === 'left' ? LEFT_MIN : RIGHT_MIN,
        max,
      );
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => applyWidth(next));
    };

    const onUp = (ev: PointerEvent) => {
      try { target.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      if (raf) cancelAnimationFrame(raf);
      document.body.classList.remove('is-resizing-sidebar');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const rounded = Math.round(latest);
      if (side === 'left') {
        setLeftW(rounded);
        try { localStorage.setItem(LEFT_W_KEY, String(rounded)); } catch { /* ignore */ }
      } else {
        setRightW(rounded);
        try { localStorage.setItem(RIGHT_W_KEY, String(rounded)); } catch { /* ignore */ }
      }
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
  }, [leftW, rightW]);

  const switchTo = (next: Screen) => {
    const from = TABS.findIndex(tab => tab.id === screen);
    const to = TABS.findIndex(tab => tab.id === next);
    setDirection(to >= from ? 1 : -1);
    setScreen(next);
    telegramImpact('light');
  };

  const toggleTheme = () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    telegramImpact('light');
  };

  useEffect(() => {
    setTheme(syncThemeFromTelegram());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timeout);
  }, [toast]);

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

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      setHeaderBlur(Math.min(1, y / 40));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    void import('./screens/Market');
    const warm = window.setTimeout(() => {
      void import('./screens/Deals');
      void import('./screens/Chats');
      void import('./screens/Profile');
      void import('./screens/ProductForm');
    }, 1500);
    return () => window.clearTimeout(warm);
  }, []);

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
  const showAuth = Boolean(banNotice)
    || core.states.profile === 'error'
    || (core.states.profile !== 'loading' && !core.profile);
  const shellReady = core.states.products === 'success'
    || core.states.products === 'error'
    || Boolean(core.profile)
    || core.states.profile === 'error';
  const chatImmersive = screen === 'chat';
  const activeTab = Math.max(0, TABS.findIndex(tab => tab.id === screen));
  const showMarketRail = screen === 'market' && !chatImmersive;
  const sidebarCatCounts = CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = core.products.filter((p) => p.category === cat).length;
    return acc;
  }, {});

  return <>
    <Suspense fallback={null}>
      <OnixBackground mode={mode} />
    </Suspense>
    <div
      className={`app-shell ${shellReady ? 'is-ready' : 'is-booting'}${chatImmersive ? ' app-shell--chat' : ''}${showAuth ? ' app-shell--auth' : ''}${showMarketRail ? ' app-shell--market' : ''}${leftIcons ? ' app-shell--left-icons' : ''}${rightIcons && showMarketRail ? ' app-shell--right-icons' : ''}`}
      style={{
        '--header-blur': headerBlur,
        '--sidebar-left-w': `${leftW}px`,
        '--sidebar-right-w': `${rightW}px`,
      } as CSSProperties}
    >
    <a className="skip-link" href="#content">К содержимому</a>

    {showAuth && (
      <Suspense fallback={null}>
        <AuthNotice
          miniApp={isTelegramMiniApp()}
          message={core.errors.profile}
          ban={banNotice}
          onAuthenticated={onAuthenticated}
          onBan={setBanNotice}
        />
      </Suspense>
    )}

    {/* Desktop left sidebar */}
    <aside className={`sidebar-left desktop-only${leftIcons ? ' sidebar-left--icons' : ''}`} aria-label="Навигация">
      <div className="sidebar-left__brand"><BrandMark /></div>
      <nav className="sidebar-nav">
        {SIDEBAR_NAV.map((item) => (
          <button
            key={item.label}
            type="button"
            className={screen === item.id ? 'active' : ''}
            onClick={() => switchTo(item.id)}
            title={item.label}
            aria-label={item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-cats">
        {CATEGORIES.map((cat) => {
          const style = CAT_STYLE[cat];
          const count = sidebarCatCounts[cat] ?? 0;
          return (
            <button
              key={cat}
              type="button"
              title={CATEGORY_LABELS[cat]}
              aria-label={CATEGORY_LABELS[cat]}
              onClick={() => {
                setMarketCategory(cat);
                switchTo('market');
              }}
            >
              <span
                className="cat-card__emblem"
                style={{ width: 28, height: 28, fontSize: 10, background: style.bg, boxShadow: `0 0 12px ${style.glow}` }}
              >{style.letter}</span>
              <span className="sidebar-cats__label">{CATEGORY_LABELS[cat]}</span>
              <em className="sidebar-cats__count" title={`${count} лотов`}>{formatLotCount(count)}</em>
            </button>
          );
        })}
      </div>
      <div className="sidebar-spacer" />
      <button
        type="button"
        className="sidebar-theme"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
        title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      >
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
        <span>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
      </button>
      <button
        type="button"
        className="sidebar-resizer sidebar-resizer--left"
        aria-label="Изменить ширину левой панели"
        onPointerDown={(e) => startResize('left', e)}
      />
    </aside>

    {/* keep theme on mobile topbar */}
    {!chatImmersive && (
      <header className="topbar mobile-only">
        <BrandMark />
        <div className="topbar__actions">
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <button type="button" className="icon-btn" aria-label="Поиск" onClick={() => {
            const el = document.querySelector<HTMLInputElement>('input[type="search"]');
            el?.focus();
          }}>
            <IconSearch />
          </button>
          <button type="button" className="icon-btn" aria-label="Уведомления">
            <IconBell />
            {core.unread > 0 && <span className="icon-btn__badge" />}
          </button>
          <div className="identity">
            {core.states.profile === 'loading' && !core.profile ? (
              <strong>…</strong>
            ) : core.profile ? (
              <span className="user-summary identity-user" aria-label="Баланс">
                <UserAvatar avatarUrl={core.profile.avatarUrl} name={core.profile.username} online />
                <strong>{money(core.profile.balanceCents)}</strong>
              </span>
            ) : (
              <strong>—</strong>
            )}
          </div>
        </div>
      </header>
    )}

    <main id="content" className="viewport" style={{ '--direction': direction } as CSSProperties}>
      <div key={screen} className="screen-transition">
        <Suspense fallback={<ScreenFallback />}>
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
            externalCategory={marketCategory}
            onExternalCategoryConsumed={() => setMarketCategory('Все')}
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
            openTopup={openWalletTopup}
            onTopupConsumed={() => setOpenWalletTopup(false)}
            openDealChat={(chatId) => {
              setFocusChatId(chatId);
              switchTo('chat');
            }}
          />}
        </Suspense>
      </div>
    </main>

    {/* Market-only right rail */}
    {showMarketRail && (
      <aside
        className={`sidebar-right desktop-only${rightIcons ? ' sidebar-right--icons' : ''}`}
        aria-label="Виджеты"
      >
        <button
          type="button"
          className="sidebar-resizer sidebar-resizer--right"
          aria-label="Изменить ширину правой панели"
          onPointerDown={(e) => startResize('right', e)}
        />
        {rightIcons ? (
          <div className="sidebar-right__icons">
            <button type="button" title="Wallet" aria-label="Wallet" onClick={() => { setOpenWalletTopup(true); switchTo('profile'); }}>
              <IconWallet size={20} />
            </button>
            <button type="button" title="Уведомления" aria-label="Уведомления" onClick={() => switchTo('deals')}>
              <IconBell />
            </button>
            <button type="button" title="Новые лоты" aria-label="Новые лоты" onClick={() => switchTo('market')}>
              <IconLot />
            </button>
          </div>
        ) : (
          <>
            <div className="widget widget--glass">
              <p className="wallet-hero__label">Wallet</p>
              <div className="wallet-hero__amount">
                {core.profile ? money(core.profile.balanceCents) : '—'}
                <small>RUB</small>
              </div>
              <div style={{ marginTop: 14 }}>
                <Button
                  variant="violet"
                  style={{ width: '100%' }}
                  onClick={() => {
                    setOpenWalletTopup(true);
                    switchTo('profile');
                  }}
                >
                  <IconWallet size={18} /> Add Funds
                </Button>
              </div>
            </div>
            <div className="widget widget--glass">
              <h3>Live Notifications</h3>
              <div className="widget-notify">
                {!core.profile ? (
                  <p className="widget-empty">Войдите, чтобы видеть личные уведомления.</p>
                ) : core.states.notifications === 'loading' && core.notifications.length === 0 ? (
                  <p className="widget-empty">Загрузка…</p>
                ) : core.notifications.length === 0 ? (
                  <p className="widget-empty">Пока нет уведомлений — здесь появятся оплаты, сделки и системные события.</p>
                ) : (
                  core.notifications.slice(0, 6).map((item: Notification) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`widget-notify__row${item.read ? '' : ' is-unread'}`}
                      onClick={() => {
                        if (!item.read) void core.markNotificationRead(item.id);
                      }}
                    >
                      <UserAvatar name={item.title.slice(0, 2) || 'ON'} size="small" />
                      <p>
                        <b>{item.title}</b>
                        {item.body ? <span> {item.body}</span> : null}
                      </p>
                      <time>{relativeTime(item.createdAt)}</time>
                    </button>
                  ))
                )}
              </div>
              <button type="button" className="widget-link" onClick={() => switchTo('deals')}>Мои сделки →</button>
            </div>
            <div className="widget widget--glass">
              <h3>Новые лоты</h3>
              <div className="widget-trend">
                {core.products.length === 0 ? (
                  <p className="widget-empty">Лотов пока нет.</p>
                ) : (
                  core.products.slice(0, 5).map((product: Product) => {
                    const style = CAT_STYLE[product.category] ?? CAT_STYLE.OTHER;
                    return (
                      <button
                        type="button"
                        className="widget-trend__row widget-trend__row--btn"
                        key={product.id}
                        onClick={() => openProductCard(product.id)}
                      >
                        <span
                          className="cat-card__emblem"
                          style={{ width: 28, height: 28, fontSize: 10, background: style.bg, boxShadow: `0 0 12px ${style.glow}` }}
                        >{style.letter}</span>
                        <span className="widget-trend__title">{product.title}</span>
                        <strong>{money(product.priceCents)}</strong>
                      </button>
                    );
                  })
                )}
              </div>
              <button type="button" className="widget-link" onClick={() => switchTo('market')}>Все лоты →</button>
            </div>
          </>
        )}
      </aside>
    )}

    <nav className="bottom-nav mobile-only" aria-label="Основная навигация">
      <span className="nav-indicator" style={{ transform: `translateX(${activeTab * 100}%)` }} />
      {TABS.map(tab => (
        <button
          key={tab.id}
          className={screen === tab.id ? 'active' : ''}
          onClick={() => switchTo(tab.id)}
          aria-current={screen === tab.id ? 'page' : undefined}
        >
          <span aria-hidden="true">{tab.icon}</span>
          <small>{tab.label}</small>
          {tab.id === 'chat' && core.unread > 0 && <b className="nav-count">{unread}</b>}
        </button>
      ))}
    </nav>
    {toast && <Toast message={toast} />}
  </div>
  </>;
}
