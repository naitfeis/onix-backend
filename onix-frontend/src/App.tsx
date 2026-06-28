import { useEffect, useState, useCallback } from 'react';
import WebApp from '@twa-dev/sdk';
import MarketScreen from './screens/MarketScreen';
import ChatScreen from './screens/ChatScreen';
import ProfileScreen from './screens/ProfileScreen';
import CreateProductScreen from './screens/CreateProductScreen';
import DealScreen from './screens/DealScreen';

type Screen = 'market' | 'chat' | 'profile' | 'create' | 'deals';

interface IUserState {
  name: string;
  balance: string;
  tgId: string;
}

const TABS: Array<{ id: Screen; icon: string; label: string; activeColor: string }> = [
  { id: 'market',  icon: '🛒', label: 'РЫНОК',   activeColor: '#00d2d3' },
  { id: 'deals',   icon: '🔒', label: 'СДЕЛКИ',  activeColor: '#ff9f43' },
  { id: 'create',  icon: '📦', label: 'ЛОТ',     activeColor: '#1dd1a1' },
  { id: 'chat',    icon: '💬', label: 'ЧАТ',     activeColor: '#00d2d3' },
  { id: 'profile', icon: '⚙️', label: 'ПРОФИЛЬ', activeColor: '#888888' },
];

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('market');
  const [user, setUser] = useState<IUserState>({ name: '...', balance: '0.00', tgId: '' });

  const getTgId = (): string => {
    try {
      return WebApp.initDataUnsafe?.user?.id?.toString() ?? '7099007790';
    } catch {
      return '7099007790';
    }
  };

  const syncProfile = useCallback(async () => {
    const tgId = getTgId();
    try {
      const res = await fetch(`/api/users/profile?tgId=${tgId}`, {
        headers: { 'x-telegram-init-data': WebApp.initData || '' },
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setUser({
          name: result.data.telegramNick,
          balance: result.data.balanceMain,
          tgId,
        });
      }
    } catch {
      // В dev-режиме без Telegram просто показываем дефолт
      setUser({ name: 'dev_trader', balance: '5000.00', tgId });
    }
  }, []);

  useEffect(() => {
    try { WebApp.ready(); WebApp.expand(); } catch {}
    syncProfile();

    const handleTabSwitch = (e: Event) => {
      const ev = e as CustomEvent<{ tab?: string }>;
      if (!ev.detail?.tab) return;
      const target = ev.detail.tab === 'create_lot' ? 'create' : ev.detail.tab;
      setCurrentScreen(target as Screen);
    };

    window.addEventListener('onix.switch_tab', handleTabSwitch);
    return () => window.removeEventListener('onix.switch_tab', handleTabSwitch);
  }, [syncProfile]);

  const handleTabClick = (id: Screen) => {
    try { WebApp.HapticFeedback.impactOccurred('light'); } catch {}
    setCurrentScreen(id);
    // Обновляем баланс при возврате в профиль
    if (id === 'profile') syncProfile();
  };

  return (
    <div style={{
      backgroundColor: '#000',
      color: '#fff',
      minHeight: '100vh',
      fontFamily: 'monospace',
      padding: '16px 16px 80px 16px',
      boxSizing: 'border-box',
    }}>
      {/* ── Шапка ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ border: '2px solid #fff', padding: '5px 20px', fontSize: '20px', fontWeight: 900, letterSpacing: '4px' }}>
          O N I X
        </div>
        <div style={{ background: '#0b0b0b', border: '1px solid #1c1c1c', padding: '7px 12px', fontSize: '10px', color: '#666' }}>
          {user.balance} ₽ // @{user.name}
        </div>
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid #1a1a1a', marginBottom: '16px' }} />

      {/* ── Экраны ── */}
      <main>
        {currentScreen === 'market'  && <MarketScreen tgId={user.tgId} />}
        {currentScreen === 'deals'   && <DealScreen tgId={user.tgId} />}
        {currentScreen === 'create'  && <CreateProductScreen tgId={user.tgId} onSuccess={() => setCurrentScreen('market')} />}
        {currentScreen === 'chat'    && <ChatScreen tgId={user.tgId} />}
        {currentScreen === 'profile' && <ProfileScreen tgId={user.tgId} onBalanceUpdate={syncProfile} />}
      </main>

      {/* ── Таб-бар ── */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, height: '64px',
        backgroundColor: '#030303', borderTop: '1px solid #1a1a1a',
        display: 'flex', zIndex: 1000,
      }}>
        {TABS.map((tab) => {
          const active = currentScreen === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              style={{
                flex: 1, background: 'none', border: 'none',
                borderTop: active ? `2px solid ${tab.activeColor}` : '2px solid transparent',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: active ? tab.activeColor : '#444',
                cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'monospace',
              }}
            >
              <span style={{ fontSize: '18px' }}>{tab.icon}</span>
              <span style={{ fontSize: '8px', marginTop: '2px', fontWeight: active ? 900 : 400 }}>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}