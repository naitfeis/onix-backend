import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import { money } from './api/client';
import { isTelegramMiniApp, telegramImpact } from './auth/telegramEnv';
import { refreshBanInfo, type BanInfo } from './api/contracts';
import UserAvatar from './components/UserAvatar';
import { Card, Skeleton, Toast } from './design-system';
import { useOnixCore } from './hooks/useOnixCore';
import type { Screen } from './screens/types';
import { formatOnixId } from './utils/onixId';
import './App.css';

const OnixBackground = lazy(() => import('./components/OnixBackground'));
const AuthNotice = lazy(() => import('./screens/AuthGate'));
const Market = lazy(() => import('./screens/Market'));
const Deals = lazy(() => import('./screens/Deals'));
const ProductForm = lazy(() => import('./screens/ProductForm'));
const Chats = lazy(() => import('./screens/Chats'));
const Profile = lazy(() => import('./screens/Profile'));

const TABS: Array<{ id: Screen; icon: string; label: string }> = [
  { id: 'market', icon: '🛒', label: 'РЫНОК' }, { id: 'deals', icon: '🔒', label: 'СДЕЛКИ' },
  { id: 'create', icon: '📦', label: 'ЛОТ' }, { id: 'chat', icon: '💬', label: 'ЧАТ' },
  { id: 'profile', icon: '◉', label: 'ПРОФИЛЬ' },
];

/** Same visual as market loading — no UI change while chunk loads. */
function ScreenFallback() {
  return <div className="stack"><div className="product-grid"><Card><Skeleton lines={4} /></Card><Card><Skeleton lines={4} /></Card></div></div>;
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
  const [bgReady, setBgReady] = useState(false);

  const switchTo = (next: Screen) => {
    const from = TABS.findIndex(tab => tab.id === screen);
    const to = TABS.findIndex(tab => tab.id === next);
    setDirection(to >= from ? 1 : -1);
    setScreen(next);
    telegramImpact('light');
  };

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

  // Defer WebGL background until after first paint (keeps initial JS execution short).
  useEffect(() => {
    const start = () => setBgReady(true);
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(start, { timeout: 1200 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(start, 0);
    return () => window.clearTimeout(t);
  }, []);

  // Prefetch default screen + warm neighbors after shell mounts.
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
  // Background stays alive on every tab (chat only slightly softer inside the shader).
  const mode = screen === 'chat' ? 'chat' : screen === 'deals' || screen === 'create' ? 'focus' : 'normal';
  const unread = core.unread > 99 ? '99+' : String(core.unread);
  const showAuth = core.states.profile === 'error' || Boolean(banNotice);
  const shellReady = core.states.products === 'success'
    || core.states.products === 'error'
    || Boolean(core.profile)
    || core.states.profile === 'error';

  return <div className={`app-shell ${shellReady ? 'is-ready' : 'is-booting'}`}>
    {bgReady && (
      <Suspense fallback={null}>
        <OnixBackground mode={mode} />
      </Suspense>
    )}
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
            <span>// @{core.profile.username} · {formatOnixId(core.profile.onixId)}</span>
          </span>
        ) : (
          <><strong>ГОСТЬ</strong><span>// БЕЗ СЕССИИ</span></>
        )}
      </div>
    </header>
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
        </Suspense>
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
