import { lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { money } from './api/client';
import { CATEGORIES, CATEGORY_LABELS, refreshBanInfo, type BanInfo } from './api/contracts';
import { isTelegramMiniApp, telegramImpact } from './auth/telegramEnv';
import UserAvatar from './components/UserAvatar';
import {
  BrandMark,
  IconBell,
  IconChat,
  IconDeals,
  IconHeart,
  IconHelp,
  IconHome,
  IconLot,
  IconMarket,
  IconMoon,
  IconProfile,
  IconSearch,
  IconSettings,
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

const TABS: Array<{ id: Screen; label: string; icon: ReactNode }> = [
  { id: 'market', label: 'Market', icon: <IconMarket /> },
  { id: 'deals', label: 'Deals', icon: <IconDeals /> },
  { id: 'create', label: 'Lot', icon: <IconLot /> },
  { id: 'chat', label: 'Chat', icon: <IconChat /> },
  { id: 'profile', label: 'Profile', icon: <IconProfile /> },
];

const SIDEBAR_NAV: Array<{ id: Screen; label: string; icon: ReactNode }> = [
  { id: 'market', label: 'Home', icon: <IconHome /> },
  { id: 'market', label: 'Market', icon: <IconMarket /> },
  { id: 'deals', label: 'My Orders', icon: <IconDeals /> },
  { id: 'profile', label: 'Favorites', icon: <IconHeart /> },
  { id: 'chat', label: 'Messages', icon: <IconChat /> },
  { id: 'create', label: 'Sell Account', icon: <IconLot /> },
];

const CAT_STYLE: Record<string, { bg: string; glow: string; letter: string }> = {
  STANDOFF_2: { bg: 'linear-gradient(145deg,#E8B93E,#C4982E)', glow: 'rgba(232,185,62,.35)', letter: 'S2' },
  STEAM: { bg: 'linear-gradient(145deg,#4A8FE0,#346FB8)', glow: 'rgba(74,143,224,.32)', letter: 'ST' },
  ROBLOX: { bg: 'linear-gradient(145deg,#E14B5A,#B83846)', glow: 'rgba(225,75,90,.32)', letter: 'RB' },
  RP_PROJECTS: { bg: 'linear-gradient(145deg,#8B7FF5,#6B5FE0)', glow: 'rgba(139,127,245,.32)', letter: 'RP' },
  BRAWL_STARS: { bg: 'linear-gradient(145deg,#E8934A,#C47535)', glow: 'rgba(232,147,74,.32)', letter: 'BS' },
  OTHER: { bg: 'linear-gradient(145deg,#8A8B96,#63646E)', glow: 'rgba(138,139,150,.28)', letter: '··' },
};

function ScreenFallback() {
  return <div className="stack"><div className="product-grid"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div></div>;
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
  const showAuth = core.states.profile === 'error' || Boolean(banNotice);
  const shellReady = core.states.products === 'success'
    || core.states.products === 'error'
    || Boolean(core.profile)
    || core.states.profile === 'error';
  const chatImmersive = screen === 'chat';
  const activeTab = Math.max(0, TABS.findIndex(tab => tab.id === screen));

  return <>
    <Suspense fallback={null}>
      <OnixBackground mode={mode} />
    </Suspense>
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
    >
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
    <div
      className={`app-shell ${shellReady ? 'is-ready' : 'is-booting'}${chatImmersive ? ' app-shell--chat' : ''}`}
      style={{ '--header-blur': headerBlur } as CSSProperties}
    >
    <a className="skip-link" href="#content">К содержимому</a>

    {/* Desktop left sidebar */}
    <aside className="sidebar-left desktop-only" aria-label="Навигация">
      <div className="sidebar-left__brand"><BrandMark /></div>
      <nav className="sidebar-nav">
        {SIDEBAR_NAV.map((item, index) => (
          <button
            key={`${item.label}-${index}`}
            type="button"
            className={screen === item.id && (item.label !== 'Favorites') ? 'active' : ''}
            onClick={() => {
              if (item.label === 'Favorites') {
                switchTo('profile');
                return;
              }
              switchTo(item.id);
            }}
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
          return (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setMarketCategory(cat);
                switchTo('market');
              }}
            >
              <span
                className="cat-card__emblem"
                style={{ width: 28, height: 28, fontSize: 10, background: style.bg, boxShadow: `0 0 12px ${style.glow}` }}
              >{style.letter}</span>
              {CATEGORY_LABELS[cat]}
              <em className="sidebar-cats__count">·</em>
            </button>
          );
        })}
      </div>
      <div className="sidebar-spacer" />
      <nav className="sidebar-nav">
        <button type="button" onClick={() => switchTo('profile')}><IconSettings /><span>Settings</span></button>
        <button type="button"><IconHelp /><span>Help</span></button>
      </nav>
      <button type="button" className="sidebar-cta" onClick={() => switchTo('create')}>Become a Seller</button>
    </aside>

    {!chatImmersive && (
      <header className="topbar mobile-only">
        <BrandMark />
        <div className="topbar__actions">
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
            openDealChat={(chatId) => {
              setFocusChatId(chatId);
              switchTo('chat');
            }}
          />}
        </Suspense>
      </div>
    </main>

    {/* Desktop right widgets */}
    {!chatImmersive && (
      <aside className="sidebar-right desktop-only" aria-label="Виджеты">
        <div className="widget">
          <p className="wallet-hero__label">Wallet</p>
          <div className="wallet-hero__amount">
            {core.profile ? money(core.profile.balanceCents) : '—'}
            <small>RUB</small>
          </div>
          <div style={{ marginTop: 14 }}>
            <Button variant="violet" style={{ width: '100%' }} onClick={() => switchTo('profile')}>
              <IconWallet size={18} /> Add Funds
            </Button>
          </div>
        </div>
        <div className="widget">
          <h3>Live Notifications</h3>
          <div className="widget-notify">
            <div className="widget-notify__row">
              <UserAvatar name="ONIX" size="small" />
              <p><b>Система</b> <span>безопасная сделка активирована</span></p>
              <time>2м</time>
            </div>
            <div className="widget-notify__row">
              <UserAvatar name="Seller" size="small" />
              <p><b>Продавец</b> <span>подтвердил передачу товара</span></p>
              <time>18м</time>
            </div>
            <div className="widget-notify__row">
              <UserAvatar name="Buyer" size="small" />
              <p><b>Покупатель</b> <span>оставил отзыв ★ 5.0</span></p>
              <time>1ч</time>
            </div>
            <div className="widget-notify__row">
              <UserAvatar name="ONIX" size="small" />
              <p><b>Маркет</b> <span>новый лот в Standoff 2</span></p>
              <time>3ч</time>
            </div>
          </div>
          <button type="button" className="widget-link" onClick={() => switchTo('chat')}>View All →</button>
        </div>
        <div className="widget">
          <h3>Trending Now</h3>
          <div className="widget-trend">
            {CATEGORIES.slice(0, 4).map((cat) => {
              const style = CAT_STYLE[cat];
              return (
                <div className="widget-trend__row" key={cat}>
                  <span
                    className="cat-card__emblem"
                    style={{ width: 28, height: 28, fontSize: 10, background: style.bg, boxShadow: `0 0 12px ${style.glow}` }}
                  >{style.letter}</span>
                  {CATEGORY_LABELS[cat]}
                  <strong>★ 4.{8 - CATEGORIES.indexOf(cat) % 3}</strong>
                </div>
              );
            })}
          </div>
        </div>
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
