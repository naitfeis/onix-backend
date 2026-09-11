import { Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import SiteFooter from './components/SiteFooter';
import { api, money, moneyAmount } from './api/client';
import { CATEGORIES, API_PATHS, refreshBanInfo, type BanInfo, type Notification, type Product } from './api/contracts';
import { isTelegramMiniApp, telegramImpact } from './auth/telegramEnv';
import SoftErrorBoundary from './components/SoftErrorBoundary';
import UserAvatar from './components/UserAvatar';
import { publicAt } from './utils/publicAt';
import {
  BrandMark,
  IconChat,
  IconClose,
  IconDeals,
  IconEye,
  IconLot,
  IconMarket,
  IconMoon,
  IconProfile,
  IconSettings,
  IconSun,
  IconWallet,
} from './components/NavIcons';
import { Button, Card, Skeleton, Toast } from './design-system';
import { popModal, pushModal } from './design-system/modalStack';
import { unlockSounds } from './audio/sounds';
import { useOnixCore } from './hooks/useOnixCore';
import { t, categoryLabel, MARKET_ALL_CATEGORY } from './i18n';
import { useLocale } from './i18n/useLocale';
import AuthNotice, { WebsiteLoginBridge, isWebsiteLoginStartParam } from './screens/AuthGate';
import type { Screen } from './screens/types';
import PwaInstallBanner from './shell/PwaInstallBanner';
import { CATEGORY_IMAGES } from './utils/categoryImages';
import { lazyRetry } from './utils/lazyRetry';
import './App.css';

/** AuthGate is eager — lazy chunk ERR_CONNECTION_RESET was blanking the whole app in RU. */
const OnixBackground = lazyRetry(() => import('./components/OnixBackground'));
const Market = lazyRetry(() => import('./screens/Market'));
const Deals = lazyRetry(() => import('./screens/Deals'));
const ProductForm = lazyRetry(() => import('./screens/ProductForm'));
const Chats = lazyRetry(() => import('./screens/Chats'));
const Profile = lazyRetry(() => import('./screens/Profile'));

const LEFT_W_KEY = 'onix-sidebar-left-w';
const RIGHT_W_KEY = 'onix-sidebar-right-w';
/** Floor above icon-rail — prevents the crushed 72px rail + brand/icon overlap. */
const LEFT_MIN = 220;
const LEFT_DEFAULT = 272;
const RIGHT_MIN = 64;
const RIGHT_DEFAULT = 320;
const RIGHT_ICONS_AT = 88;
/** Below this, the right rail shows icon-only — never a crushed widget column. */
const RIGHT_CONTENT_MIN = 240;
/** Keep below LEFT_MIN so left never enters icon-only mode via resize. */
const LEFT_ICONS_AT = 200;
const DESKTOP_MAIN_MIN = 520;
const DESKTOP_GAPS = 32;
const TABS: Array<{ id: Screen; labelKey: Parameters<typeof t>[0]; icon: ReactNode }> = [
  { id: 'market', labelKey: 'navigation.market', icon: <IconMarket /> },
  { id: 'deals', labelKey: 'navigation.deals', icon: <IconDeals /> },
  { id: 'create', labelKey: 'navigation.lot', icon: <IconLot /> },
  { id: 'chat', labelKey: 'navigation.chat', icon: <IconChat /> },
  { id: 'profile', labelKey: 'navigation.profile', icon: <IconProfile /> },
];

const SIDEBAR_NAV: Array<{ id: Screen; labelKey: Parameters<typeof t>[0]; icon: ReactNode }> = [
  { id: 'market', labelKey: 'navigation.market', icon: <IconMarket /> },
  { id: 'deals', labelKey: 'navigation.orders', icon: <IconDeals /> },
  { id: 'profile', labelKey: 'navigation.profile', icon: <IconProfile /> },
  { id: 'chat', labelKey: 'navigation.messages', icon: <IconChat /> },
  { id: 'create', labelKey: 'navigation.sell', icon: <IconLot /> },
];

const CAT_STYLE: Record<string, { bg: string; glow: string; letter: string }> = {
  STANDOFF_2: { bg: 'linear-gradient(145deg,#E8B93E,#C4982E)', glow: 'rgba(232,185,62,.35)', letter: 'S2' },
  STEAM: { bg: 'linear-gradient(145deg,#4A8FE0,#346FB8)', glow: 'rgba(74,143,224,.32)', letter: 'ST' },
  ROBLOX: { bg: 'linear-gradient(145deg,#5B8DEF,#3D6FD4)', glow: 'rgba(91,141,239,.32)', letter: 'RB' },
  RP_PROJECTS: { bg: 'linear-gradient(145deg,#8B7FF5,#6B5FE0)', glow: 'rgba(139,127,245,.32)', letter: 'RP' },
  BRAWL_STARS: { bg: 'linear-gradient(145deg,#E8934A,#C47535)', glow: 'rgba(232,147,74,.32)', letter: 'BS' },
  CS2: { bg: 'linear-gradient(145deg,#F08A2E,#C45A1A)', glow: 'rgba(240,138,46,.35)', letter: 'CS' },
  FORTNITE: { bg: 'linear-gradient(145deg,#6EC8FF,#3B8FE0)', glow: 'rgba(110,200,255,.32)', letter: 'FN' },
  VALORANT: { bg: 'linear-gradient(145deg,#FF4655,#C43A45)', glow: 'rgba(255,70,85,.32)', letter: 'VA' },
  GTA_5: { bg: 'linear-gradient(145deg,#4CAF50,#2E7D32)', glow: 'rgba(76,175,80,.32)', letter: 'V' },
  GTA_6: { bg: 'linear-gradient(145deg,#E91E8C,#7B2CBF)', glow: 'rgba(233,30,140,.32)', letter: 'VI' },
  DOTA_2: { bg: 'linear-gradient(145deg,#C23B2F,#8B1E18)', glow: 'rgba(194,59,47,.35)', letter: 'D2' },
  PUBG_MOBILE: { bg: 'linear-gradient(145deg,#F5A623,#E85D04)', glow: 'rgba(245,166,35,.32)', letter: 'PG' },
  GENSHIN: { bg: 'linear-gradient(145deg,#4FC3F7,#1A73A8)', glow: 'rgba(79,195,247,.32)', letter: 'GI' },
  MOBILE_LEGENDS: { bg: 'linear-gradient(145deg,#2D3436,#636E72)', glow: 'rgba(45,52,54,.28)', letter: 'ML' },
  APP_STORE: { bg: 'linear-gradient(145deg,#2F7CF6,#1A56C8)', glow: 'rgba(47,124,246,.32)', letter: 'AS' },
  PUBG: { bg: 'linear-gradient(145deg,#2C2C2C,#111111)', glow: 'rgba(0,0,0,.28)', letter: 'PG' },
  MINECRAFT: { bg: 'linear-gradient(145deg,#5D9C3D,#3E6B28)', glow: 'rgba(93,156,61,.32)', letter: 'MC' },
  PLAYSTATION: { bg: 'linear-gradient(145deg,#0070D1,#003B8E)', glow: 'rgba(0,112,209,.32)', letter: 'PS' },
  STALCRAFT: { bg: 'linear-gradient(145deg,#3A5F8A,#1E3348)', glow: 'rgba(58,95,138,.32)', letter: 'SC' },
  PATH_OF_EXILE_2: { bg: 'linear-gradient(145deg,#8B1E1E,#3D0F0F)', glow: 'rgba(139,30,30,.32)', letter: 'PE' },
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

function readStoredWidth(key: string, fallback: number, min = 1): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= min) return n;
    // Migrate crushed sidebar widths from older builds (icon rail ≤96px).
    if (Number.isFinite(n) && n > 0 && n < min) {
      try { localStorage.setItem(key, String(fallback)); } catch { /* ignore */ }
      return fallback;
    }
  } catch { /* ignore */ }
  return fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function snapRightWidth(width: number): number {
  if (width < RIGHT_CONTENT_MIN) {
    return width <= (RIGHT_ICONS_AT + RIGHT_CONTENT_MIN) / 2 ? RIGHT_MIN : RIGHT_CONTENT_MIN;
  }
  return width;
}

function clampSidebarWidths(shellWidth: number, left: number, right: number, showRight: boolean): { left: number; right: number } {
  let nextLeft = Math.max(LEFT_MIN, left);
  let nextRight = right <= RIGHT_ICONS_AT ? RIGHT_MIN : Math.max(right, RIGHT_CONTENT_MIN);
  if (!showRight) return { left: nextLeft, right: nextRight };
  const budget = Math.max(LEFT_MIN + RIGHT_MIN, shellWidth - DESKTOP_MAIN_MIN - DESKTOP_GAPS);
  if (nextLeft + nextRight > budget) {
    nextRight = Math.max(RIGHT_MIN, budget - nextLeft);
    if (nextRight < RIGHT_CONTENT_MIN) nextRight = RIGHT_MIN;
  }
  if (nextLeft + nextRight > budget) {
    nextLeft = Math.max(LEFT_MIN, budget - nextRight);
  }
  return { left: nextLeft, right: nextRight };
}

const THEME_KEY = 'onix-theme';
const GLASS_KEY = 'onix-glass';
/** Older builds wrote solid on first visit — migrate once to Vision as product default. */
const GLASS_DEFAULT_MIGRATION = 'onix-glass-default-vision-v1';
type ThemeMode = 'dark' | 'light';
type GlassMode = 'solid' | 'vision';

function readStoredTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  return null;
}

function readStoredGlass(): GlassMode {
  try {
    if (!localStorage.getItem(GLASS_DEFAULT_MIGRATION)) {
      localStorage.setItem(GLASS_DEFAULT_MIGRATION, '1');
      localStorage.setItem(GLASS_KEY, 'vision');
      return 'vision';
    }
    const v = localStorage.getItem(GLASS_KEY);
    if (v === 'vision' || v === 'solid') return v;
  } catch { /* ignore */ }
  return 'vision';
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute('data-theme', theme);
  const color = theme === 'light' ? '#F4F2F8' : '#000000';
  document.querySelectorAll('meta[name="theme-color"]').forEach((node) => {
    node.setAttribute('content', color);
  });
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* ignore */ }
}

function applyGlass(mode: GlassMode) {
  document.documentElement.setAttribute('data-glass', mode);
  try {
    localStorage.setItem(GLASS_KEY, mode);
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
  const { locale, setLocale } = useLocale();
  const [screen, setScreen] = useState<Screen>('market');
  const [direction, setDirection] = useState(1);
  const [toast, setToast] = useState('');
  const [banNotice, setBanNotice] = useState<BanInfo | undefined>();
  /** Soft login CTA for guests (buy / protected tabs) — does not block market browse. */
  const [loginPrompt, setLoginPrompt] = useState(false);
  const [focusChatId, setFocusChatId] = useState<string | null>(null);
  const [focusProductId, setFocusProductId] = useState<string | null>(null);
  const [focusDealId, setFocusDealId] = useState<string | null>(null);
  const [marketCategory, setMarketCategory] = useState<string>(MARKET_ALL_CATEGORY);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    const { id } = pushModal(() => setSettingsOpen(false), { lockBody: false });
    return () => popModal(id);
  }, [settingsOpen]);
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme() ?? 'dark');
  const [glass, setGlass] = useState<GlassMode>(() => {
    const mode = readStoredGlass();
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-glass', mode);
    return mode;
  });
  const [openWalletTopup, setOpenWalletTopup] = useState(false);
  const [leftW, setLeftW] = useState(() => readStoredWidth(LEFT_W_KEY, LEFT_DEFAULT, LEFT_MIN));
  const [rightW, setRightW] = useState(() => readStoredWidth(RIGHT_W_KEY, RIGHT_DEFAULT, RIGHT_MIN));
  const [shellWidth, setShellWidth] = useState(() => (
    typeof window === 'undefined' ? 1440 : window.innerWidth
  ));

  useEffect(() => {
    let raf = 0;
    const sync = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = window.innerWidth;
        setShellWidth((prev) => (prev === next ? prev : next));
      });
    };
    sync();
    window.addEventListener('resize', sync, { passive: true });
    window.visualViewport?.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('resize', sync);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const showRightRail = screen === 'market' && shellWidth >= 1280;
  const rails = useMemo(
    () => clampSidebarWidths(shellWidth, leftW, rightW, showRightRail),
    [shellWidth, leftW, rightW, showRightRail],
  );
  const leftIcons = rails.left <= LEFT_ICONS_AT;
  const rightIcons = rails.right <= RIGHT_ICONS_AT;
  const [miniApp, setMiniApp] = useState(() => isTelegramMiniApp());
  const [websiteLoginBridge, setWebsiteLoginBridge] = useState(() => isWebsiteLoginStartParam());
  useEffect(() => {
    if (miniApp && websiteLoginBridge) return;
    const id = window.setInterval(() => {
      if (isTelegramMiniApp()) setMiniApp(true);
      if (isWebsiteLoginStartParam()) setWebsiteLoginBridge(true);
      if (isTelegramMiniApp() && isWebsiteLoginStartParam()) window.clearInterval(id);
    }, 80);
    const stop = window.setTimeout(() => window.clearInterval(id), 2500);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [miniApp, websiteLoginBridge]);

  useEffect(() => {
    const unlock = () => unlockSounds();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const startResize = useCallback((side: 'left' | 'right', event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = side === 'left' ? rails.left : rails.right;
    const target = event.currentTarget;
    const shell = target.closest('.app-shell') as HTMLElement | null;
    target.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-sidebar');

    let latest = startW;
    let raf = 0;
    let iconMode = side === 'left' ? leftIcons : rightIcons;

    const applyWidth = (next: number) => {
      latest = next;
      if (!shell) return;
      if (side === 'left') {
        shell.style.setProperty('--sidebar-left-w', `${next}px`);
        const icons = next <= LEFT_ICONS_AT;
        shell.classList.toggle('app-shell--left-icons', icons);
        shell.querySelector('.sidebar-left')?.classList.toggle('sidebar-left--icons', icons);
        if (icons !== iconMode) {
          iconMode = icons;
          setLeftW(Math.round(next));
        }
      } else {
        shell.style.setProperty('--sidebar-right-w', `${next}px`);
        const icons = next <= RIGHT_ICONS_AT;
        shell.classList.toggle('app-shell--right-icons', icons);
        shell.querySelector('.sidebar-right')?.classList.toggle('sidebar-right--icons', icons);
        if (icons !== iconMode) {
          iconMode = icons;
          setRightW(Math.round(next));
        }
      }
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const shellWidth = shell?.clientWidth || window.innerWidth;
      const otherWidth = side === 'left' ? rails.right : rails.left;
      const available = shellWidth - otherWidth - DESKTOP_MAIN_MIN - DESKTOP_GAPS;
      const max = Math.max(
        side === 'left' ? LEFT_MIN : RIGHT_MIN,
        Math.min(
          available,
          side === 'left' ? Math.floor(shellWidth * 0.45) : Math.floor(shellWidth * 0.4),
        ),
      );
      const raw = clamp(
        side === 'left' ? startW + dx : startW - dx,
        side === 'left' ? LEFT_MIN : RIGHT_MIN,
        max,
      );
      const next = side === 'right' ? snapRightWidth(raw) : raw;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => applyWidth(next));
    };

    const onUp = (ev: PointerEvent) => {
      try { target.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      if (raf) cancelAnimationFrame(raf);
      document.body.classList.remove('is-resizing-sidebar');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const rounded = Math.round(side === 'right' ? snapRightWidth(latest) : latest);
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
  }, [leftIcons, rails.left, rails.right, rightIcons]);

  const [mountedScreens, setMountedScreens] = useState<Record<Screen, boolean>>({
    market: true,
    deals: false,
    create: false,
    chat: false,
    profile: false,
  });

  const switchTo = (next: Screen) => {
    const from = TABS.findIndex(tab => tab.id === screen);
    const to = TABS.findIndex(tab => tab.id === next);
    setDirection(to >= from ? 1 : -1);
    // Guests may browse market/lots freely; other tabs ask to sign in.
    if (
      !core.profile
      && core.sessionRestore === 'guest'
      && (next === 'deals' || next === 'create' || next === 'chat' || next === 'profile')
    ) {
      setLoginPrompt(true);
    } else if (next === 'market') {
      setLoginPrompt(false);
    }
    setMountedScreens((prev) => (prev[next] ? prev : { ...prev, [next]: true }));
    // Sync highlight immediately — startTransition made taps feel frozen.
    setScreen(next);
    telegramImpact('light');
  };

  const toggleTheme = () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    telegramImpact('light');
  };

  const toggleGlass = () => {
    const next: GlassMode = glass === 'vision' ? 'solid' : 'vision';
    setGlass(next);
    applyGlass(next);
    telegramImpact('light');
  };

  useEffect(() => {
    setTheme(syncThemeFromTelegram());
    applyGlass(readStoredGlass());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (core.profile) {
      setBanNotice(undefined);
      setLoginPrompt(false);
    }
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
    void import('./screens/Market');
    const warmScreens = () => {
      void import('./screens/Deals');
      void import('./screens/Chats');
      void import('./screens/Profile');
      void import('./screens/ProductForm');
    };
    let idleId = 0;
    let timeoutId = 0;
    const ric = window.requestIdleCallback;
    if (typeof ric === 'function') {
      idleId = ric(() => warmScreens(), { timeout: 2500 });
    } else {
      timeoutId = window.setTimeout(warmScreens, 1500);
    }
    return () => {
      if (idleId && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  const onAuthenticated = () => {
    setBanNotice(undefined);
    setLoginPrompt(false);
    void core.refreshAll();
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
  // Guests browse market + lots; soft login CTA stays visible on every screen.
  // Hard wall only for ban, website login bridge, or network session failure.
  const guestSoftAuth = !core.profile
    && !miniApp
    && !websiteLoginBridge
    && (core.sessionRestore === 'guest' || core.sessionRestore === 'network' || loginPrompt);
  const showAuth = Boolean(banNotice)
    || websiteLoginBridge
    || guestSoftAuth
    || (core.sessionRestore === 'network' && !core.profile && core.states.profile === 'error');
  const shellReady = core.states.products === 'success'
    || core.states.products === 'error'
    || Boolean(core.profile)
    || core.sessionRestore === 'guest'
    || core.sessionRestore === 'network';
  const chatImmersive = screen === 'chat';
  const activeTab = Math.max(0, TABS.findIndex(tab => tab.id === screen));
  const showMarketRail = showRightRail;
  const sidebarCatCounts = CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = core.categoryLotCounts[cat]
      ?? core.products.filter((p) => p.category === cat).length;
    return acc;
  }, {});

  const settingsFields = (
    <>
      <button
        type="button"
        className="sidebar-theme"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? t('theme.enableLight') : t('theme.enableDark')}
      >
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
        <span>{theme === 'dark' ? t('theme.light') : t('theme.dark')}</span>
      </button>
      <button
        type="button"
        className={`sidebar-theme${glass === 'vision' ? ' is-active' : ''}`}
        onClick={toggleGlass}
        aria-label={glass === 'vision' ? t('theme.disableGlass') : t('theme.enableGlass')}
        aria-pressed={glass === 'vision'}
      >
        <IconEye />
        <span>{t('theme.glass')}</span>
      </button>
      <p className="sidebar-settings__label">{t('settings.language')}</p>
      <div className="sidebar-settings__langs">
        <button
          type="button"
          className={`sidebar-settings__lang${locale === 'ru' ? ' is-active' : ''}`}
          onClick={() => setLocale('ru')}
        >
          {t('settings.languageRu')}
        </button>
        <button
          type="button"
          className={`sidebar-settings__lang${locale === 'en' ? ' is-active' : ''}`}
          onClick={() => setLocale('en')}
        >
          {t('settings.languageEn')}
        </button>
      </div>
    </>
  );

  return <>
    <SoftErrorBoundary label="Фон не загрузился — можно продолжать.">
      <Suspense fallback={null}>
        <OnixBackground mode={mode} />
      </Suspense>
    </SoftErrorBoundary>
    <div
      className={`app-shell ${shellReady ? 'is-ready' : 'is-booting'}${chatImmersive ? ' app-shell--chat' : ''}${showAuth ? ' app-shell--auth' : ''}${showMarketRail ? ' app-shell--market' : ''}${leftIcons ? ' app-shell--left-icons' : ''}${rightIcons && showMarketRail ? ' app-shell--right-icons' : ''}`}
      style={{
        '--sidebar-left-w': `${rails.left}px`,
        '--sidebar-right-w': `${rails.right}px`,
      } as CSSProperties}
    >
    <a className="skip-link" href="#content">К содержимому</a>

    {websiteLoginBridge && (
      <SoftErrorBoundary label="Не удалось подтвердить вход с сайта.">
        <WebsiteLoginBridge />
      </SoftErrorBoundary>
    )}

    {showAuth && !websiteLoginBridge && (
      <SoftErrorBoundary label="Не удалось открыть вход. Обновите страницу.">
        <AuthNotice
          miniApp={miniApp}
          soft={!banNotice && !core.profile}
          message={!banNotice && !core.profile
            ? 'Войдите, чтобы покупать, продавать и писать в чат. Маркет и лоты можно смотреть без входа.'
            : core.errors.profile}
          ban={banNotice}
          onAuthenticated={onAuthenticated}
          onBan={setBanNotice}
        />
      </SoftErrorBoundary>
    )}

    {/* Desktop left sidebar */}
    <aside className={`sidebar-left desktop-only${leftIcons ? ' sidebar-left--icons' : ''}`} aria-label={t('navigation.sidebar')}>
      <div className="sidebar-left__brand"><BrandMark /></div>
      <nav className="sidebar-nav">
        {SIDEBAR_NAV.map((item) => (
          <button
            key={item.labelKey}
            type="button"
            className={screen === item.id ? 'active' : ''}
            onClick={() => switchTo(item.id)}
            aria-label={item.id === 'profile' && core.profile ? publicAt(core.profile.username) : t(item.labelKey)}
            aria-current={screen === item.id ? 'page' : undefined}
          >
            {item.id === 'profile' && core.profile ? (
              <UserAvatar
                userId={core.profile.id}
                avatarUrl={core.profile.avatarUrl}
                name={core.profile.username}
                size="small"
              />
            ) : item.icon}
            <span className={item.id === 'profile' && core.profile ? 'sidebar-nav__nick' : undefined}>
              {item.id === 'profile' && core.profile ? publicAt(core.profile.username) : t(item.labelKey)}
            </span>
            {item.id === 'chat' && core.unread > 0 && (
              <em className="sidebar-nav__badge" aria-label={`${core.unread} ${t('chat.unread')}`}>
                {unread}
              </em>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-cats">
        {CATEGORIES.map((cat) => {
          const style = CAT_STYLE[cat];
          const count = sidebarCatCounts[cat] ?? 0;
          const image = CATEGORY_IMAGES[cat];
          return (
            <button
              key={cat}
              type="button"
              aria-label={categoryLabel(cat)}
              onClick={() => {
                setMarketCategory(cat);
                switchTo('market');
              }}
            >
              {cat === 'OTHER' ? (
                <span className="cat-card__emblem cat-card__emblem--other" style={{ width: 34, height: 34 }}>
                  <span className="cat-card__dots" aria-hidden="true"><i /><i /><i /></span>
                </span>
              ) : image ? (
                <span className="cat-card__emblem cat-card__emblem--photo" style={{ width: 34, height: 34 }}>
                  <img src={image} alt="" width={68} height={68} loading="lazy" decoding="async" draggable={false} />
                </span>
              ) : (
                <span
                  className="cat-card__emblem"
                  style={{ width: 34, height: 34, fontSize: 11, background: style.bg }}
                >{style.letter}</span>
              )}
              <span className="sidebar-cats__label">{categoryLabel(cat)}</span>
              <em className="sidebar-cats__count" aria-hidden="true">{formatLotCount(count)}</em>
            </button>
          );
        })}
      </div>
      <div className="sidebar-spacer" />
      <div className="sidebar-settings">
        <button
          type="button"
          className={`sidebar-theme${settingsOpen ? ' is-active' : ''}`}
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          aria-label={t('settings.open')}
        >
          <IconSettings />
          <span>{t('settings.title')}</span>
        </button>
      </div>
      <button
        type="button"
        className="sidebar-resizer sidebar-resizer--left"
        aria-label={t('sidebar.resizeLeft')}
        onPointerDown={(e) => startResize('left', e)}
      />
    </aside>

    {/* keep theme on mobile topbar */}
    <header className={`topbar mobile-only${chatImmersive ? ' topbar--chat' : ''}`}>
        <BrandMark />
        <div className="topbar__actions">
          <button
            type="button"
            className={`icon-btn${settingsOpen ? ' is-active' : ''}`}
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
            aria-label={t('settings.open')}
          >
            <IconSettings />
          </button>
          <div className="identity">
            {core.states.profile === 'loading' && !core.profile ? (
              <strong>…</strong>
            ) : core.profile ? (
              <span className="user-summary identity-user" aria-label={t('balance.aria')}>
                <UserAvatar userId={core.profile.id} avatarUrl={core.profile.avatarUrl} name={core.profile.username} online />
                <strong>{money(core.profile.balanceCents)}</strong>
              </span>
            ) : (
              <strong>—</strong>
            )}
          </div>
        </div>
      </header>

    <main id="content" className="viewport" style={{ '--direction': direction } as CSSProperties}>
      <div className="screen-transition">
        <SoftErrorBoundary label="Экран не загрузился (сеть). Нажмите «Обновить».">
        <Suspense fallback={<ScreenFallback />}>
          {mountedScreens.market && (
            <div className={`screen-panel${screen === 'market' ? ' is-active' : ''}`} hidden={screen !== 'market'} aria-hidden={screen !== 'market'}>
              <Market
                core={core}
                active={screen === 'market'}
                switchTo={switchTo}
                setToast={setToast}
                focusProductId={focusProductId}
                onFocusProductHandled={() => setFocusProductId(null)}
                openDirectChat={openDirectChat}
                openProductCard={openProductCard}
                onRequestLogin={() => setLoginPrompt(true)}
                openDealChat={(chatId: string) => {
                  setFocusChatId(chatId);
                  switchTo('chat');
                }}
                externalCategory={marketCategory}
                onExternalCategoryConsumed={() => setMarketCategory(MARKET_ALL_CATEGORY)}
              />
            </div>
          )}
          {mountedScreens.deals && (
            <div className={`screen-panel${screen === 'deals' ? ' is-active' : ''}`} hidden={screen !== 'deals'} aria-hidden={screen !== 'deals'}>
              <Deals
                core={core}
                active={screen === 'deals'}
                switchTo={switchTo}
                setToast={setToast}
                focusDealId={focusDealId}
                onFocusDealHandled={() => setFocusDealId(null)}
                openDirectChat={openDirectChat}
                openDealChat={(chatId: string) => {
                  setFocusChatId(chatId);
                  switchTo('chat');
                }}
              />
            </div>
          )}
          {mountedScreens.create && (
            <div className={`screen-panel${screen === 'create' ? ' is-active' : ''}`} hidden={screen !== 'create'} aria-hidden={screen !== 'create'}>
              <ProductForm core={core} onDone={() => switchTo('market')} setToast={setToast} />
            </div>
          )}
          {mountedScreens.chat && (
            <div className={`screen-panel${screen === 'chat' ? ' is-active' : ''}`} hidden={screen !== 'chat'} aria-hidden={screen !== 'chat'}>
              <Chats
                core={core}
                active={screen === 'chat'}
                focusChatId={focusChatId}
                onFocusChatHandled={() => setFocusChatId(null)}
                openDirectChat={openDirectChat}
                openProductCard={openProductCard}
                openDeal={openDeal}
                setToast={setToast}
              />
            </div>
          )}
          {mountedScreens.profile && (
            <div className={`screen-panel${screen === 'profile' ? ' is-active' : ''}`} hidden={screen !== 'profile'} aria-hidden={screen !== 'profile'}>
              <Profile
                core={core}
                switchTo={switchTo}
                setToast={setToast}
                openDirectChat={openDirectChat}
                openProductCard={openProductCard}
                openTopup={openWalletTopup}
                onTopupConsumed={() => setOpenWalletTopup(false)}
              />
            </div>
          )}
        </Suspense>
        </SoftErrorBoundary>
      </div>
      {!miniApp && !banNotice && !websiteLoginBridge && !chatImmersive ? (
        <SiteFooter
          onSupport={() => {
            void (async () => {
              if (!core.profile) {
                setLoginPrompt(true);
                setToast('Войдите, чтобы написать в поддержку.');
                return;
              }
              try {
                const thread = await api.get<{ id: string }>(API_PATHS.aiChat);
                setFocusChatId(thread.id);
              } catch { /* open chat list */ }
              switchTo('chat');
            })();
          }}
        />
      ) : null}
    </main>

    {/* Market-only right rail */}
    {showMarketRail && (
      <aside
        className={`sidebar-right desktop-only${rightIcons ? ' sidebar-right--icons' : ''}`}
        aria-label={t('widgets.aria')}
      >
        <button
          type="button"
          className="sidebar-resizer sidebar-resizer--right"
          aria-label={t('sidebar.resizeRight')}
          onPointerDown={(e) => startResize('right', e)}
        />
        {rightIcons ? (
          <div className="sidebar-right__icons">
            <button type="button" aria-label={t('widgets.wallet')} onClick={() => { setOpenWalletTopup(true); switchTo('profile'); }}>
              <IconWallet size={20} />
            </button>
          </div>
        ) : (
          <>
            <div className="widget widget--glass">
              <p className="wallet-hero__label">{t('widgets.wallet')}</p>
              <div className="wallet-hero__amount">
                <span>{core.profile ? moneyAmount(core.profile.balanceCents) : '—'}</span>
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
                  <IconWallet size={18} /> {t('widgets.addFunds')}
                </Button>
              </div>
            </div>
            <div className="widget widget--glass widget--notify">
              <h3>{t('widgets.liveNotifications')}</h3>
              <div className="widget-notify">
                {!core.profile ? (
                  <p className="widget-empty">Войдите, чтобы видеть личные уведомления.</p>
                ) : core.states.notifications === 'loading' && core.notifications.length === 0 ? (
                  <p className="widget-empty">Загрузка…</p>
                ) : core.notifications.length === 0 ? (
                  <p className="widget-empty">Пока нет уведомлений — здесь появятся оплаты, сделки и системные события.</p>
                ) : (
                  core.notifications.slice(0, 5).map((item: Notification) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`widget-notify__row${item.read ? '' : ' is-unread'}`}
                      onClick={() => {
                        if (item.chatId) {
                          setFocusChatId(item.chatId);
                          switchTo('chat');
                          return;
                        }
                        if (item.orderId) {
                          setFocusDealId(item.orderId);
                          switchTo('deals');
                          return;
                        }
                        if (item.title === 'Новое сообщение' || item.type === 'NEW_MESSAGE') {
                          const unreadChat = core.chats.find((chat) => chat.unreadCount > 0);
                          if (unreadChat) setFocusChatId(unreadChat.id);
                          switchTo('chat');
                        }
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
            </div>
            <div className="widget widget--glass widget--new-lots">
              <h3>{t('widgets.newLots')}</h3>
              <div className="widget-trend">
                {core.products.length === 0 ? (
                  <p className="widget-empty">Лотов пока нет.</p>
                ) : (
                  core.products.slice(0, 12).map((product: Product) => {
                    const style = CAT_STYLE[product.category] ?? CAT_STYLE.OTHER;
                    const image = CATEGORY_IMAGES[product.category];
                    return (
                      <button
                        type="button"
                        className="widget-trend__row widget-trend__row--btn"
                        key={product.id}
                        onClick={() => openProductCard(product.id)}
                      >
                        {image ? (
                          <span className="widget-trend__emblem widget-trend__emblem--photo">
                            <img src={image} alt="" width={28} height={28} loading="lazy" decoding="async" />
                          </span>
                        ) : (
                          <span className="widget-trend__emblem" style={{ background: style.bg }}>{style.letter}</span>
                        )}
                        <span className="widget-trend__copy">
                          <span className="widget-trend__title">{product.title}</span>
                          <strong>{money(product.priceCents)}</strong>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </aside>
    )}

    <nav className="bottom-nav mobile-only" aria-label={t('navigation.aria')}>
      <span className="nav-indicator" style={{ transform: `translateX(${activeTab * 100}%)` }} />
      {TABS.map(tab => (
        <button
          key={tab.id}
          className={screen === tab.id ? 'active' : ''}
          onClick={() => switchTo(tab.id)}
          aria-label={t(tab.labelKey)}
          aria-current={screen === tab.id ? 'page' : undefined}
        >
          <span aria-hidden="true">{tab.icon}</span>
          <small>{t(tab.labelKey)}</small>
          {tab.id === 'chat' && core.unread > 0 && <b className="nav-count">{unread}</b>}
        </button>
      ))}
    </nav>
    {toast && <Toast message={toast} />}
    {!miniApp && !banNotice && !websiteLoginBridge ? <PwaInstallBanner /> : null}
  </div>
    <div className={`settings-overlay${settingsOpen ? ' is-open' : ''}`} aria-hidden={!settingsOpen}>
      <button
        type="button"
        className="settings-sheet__backdrop"
        tabIndex={settingsOpen ? 0 : -1}
        disabled={!settingsOpen}
        aria-label={t('common.close')}
        onClick={() => setSettingsOpen(false)}
      />
      <aside className="settings-sheet" role="dialog" aria-modal={settingsOpen} aria-label={t('settings.title')}>
        <header className="settings-sheet__head">
          <h2>{t('settings.title')}</h2>
          <button
            type="button"
            className="settings-sheet__close"
            tabIndex={settingsOpen ? 0 : -1}
            disabled={!settingsOpen}
            onClick={() => setSettingsOpen(false)}
            aria-label={t('common.close')}
          >
            <IconClose />
          </button>
        </header>
        <fieldset className="settings-sheet__body" disabled={!settingsOpen}>
          {settingsFields}
        </fieldset>
      </aside>
    </div>
  </>;
}
