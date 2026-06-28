import { useEffect, useState } from 'react';
import WebApp from '@twa-dev/sdk';
import MarketScreen from './screens/MarketScreen';
import ChatScreen from './screens/ChatScreen';
import ProfileScreen from './screens/ProfileScreen';
import CreateProductScreen from './screens/CreateProductScreen';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'market' | 'chat' | 'profile' | 'create'>('market');
  const [user, setUser] = useState({ name: 'Загрузка...', balance: '0.00', id: '' });
  const [dbError, setDbError] = useState<string | null>(null);

  const syncUserProfile = async () => {
    let tgId = "7099007790"; // Дебаг-айди
    if (WebApp.initDataUnsafe?.user) {
      tgId = WebApp.initDataUnsafe.user.id.toString();
    }

    try {
      const response = await fetch(`https://onrender.com{tgId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-init-data': WebApp.initData || ''
        }
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setUser({ name: result.data.telegramNick, balance: result.data.balanceMain, id: tgId });
        setDbError(null);
      } else {
        throw new Error();
      }
    } catch {
      setDbError('Ошибка верификации ONIX Shield. Запустите строго через Telegram бота!');
    }
  };

  useEffect(() => {
    try {
      WebApp.ready();
      WebApp.expand();
    } catch {}

    syncUserProfile();

    const handleTabSwitch = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.tab) {
        setCurrentScreen(customEvent.detail.tab === 'create_lot' ? 'create' : customEvent.detail.tab);
      }
    };
    window.addEventListener('onix.switch_tab', handleTabSwitch);
    return () => window.removeEventListener('onix.switch_tab', handleTabSwitch);
  }, [currentScreen]);

  if (dbError) {
    return (
      <div style={{ background: '#000', color: '#ff4757', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', fontFamily: 'monospace' }}>
        🚨 {dbError}
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: '#000000', color: '#ffffff', minHeight: '100vh', fontFamily: 'monospace', padding: '16px 16px 90px 16px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ border: '2px solid #ffffff', padding: '6px 24px', fontSize: '22px', fontWeight: '900', letterSpacing: '4px' }}>O N I X</div>
        <div style={{ border: '1px solid #161616', background: '#0b0b0b', padding: '8px 12px', fontSize: '10px', color: '#888' }}>
          {user.balance} ₽ // @{user.name}
        </div>
      </div>

      <main style={{ minHeight: 'calc(100vh - 160px)' }}>
        {currentScreen === 'market' && <MarketScreen />}
        {currentScreen === 'chat' && <ChatScreen />}
        {currentScreen === 'profile' && <ProfileScreen />}
        {currentScreen === 'create' && <CreateProductScreen />}
      </main>

      {/* ОЧИЩЕННЫЙ ТАБ-БАР С ЧИСТЫМИ НЕОН-ИКОНКАМИ */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: '68px', backgroundColor: '#030303', borderTop: '1px solid #161616', display: 'flex', zIndex: 1000 }}>
        {[
          { id: 'market', icon: 'Ω', label: 'РЫНОК', activeColor: '#00d2d3' },
          { id: 'chat', icon: '💬', label: 'ЧАТЫ', activeColor: '#00d2d3' },
          { id: 'create', icon: '📦', label: 'ЛОТ', activeColor: '#1dd1a1' },
          { id: 'profile', icon: '⚙️', label: 'ПРОФИЛЬ', activeColor: '#888888' }
        ].map((tab) => {
          const isSelected = currentScreen === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { try { WebApp.HapticFeedback.impactOccurred('light'); } catch {} setCurrentScreen(tab.id as any); }}
              style={{ background: 'none', border: 'none', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: isSelected ? tab.activeColor : '#444' }}
            >
              <span style={{ fontSize: '20px' }}>{tab.icon}</span>
              <span style={{ fontSize: '9px', marginTop: '3px' }}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}