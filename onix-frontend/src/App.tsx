import { useEffect, useState } from 'react';
import WebApp from '@twa-dev/sdk';
import MarketScreen from './screens/MarketScreen';
import ChatScreen from './screens/ChatScreen';
import ProfileScreen from './screens/ProfileScreen';
import CreateProductScreen from './screens/CreateProductScreen';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'market' | 'chat' | 'profile' | 'create'>('market');
  const [user, setUser] = useState({
    name: 'Загрузка...',
    photo: 'https://unsplash.com'
  });

  useEffect(() => {
    // Безопасный клиринг сессии Telegram Web App SDK [проф. 1]
    try {
      if (WebApp.initData && WebApp.initDataUnsafe?.user) {
        WebApp.ready();
        WebApp.expand();
        const tgUser = WebApp.initDataUnsafe.user;
        setUser({
          name: tgUser.username ? `@${tgUser.username}` : `${tgUser.first_name} ${tgUser.last_name || ''}`.trim(),
          photo: tgUser.photo_url || 'https://unsplash.com'
        });
      } else {
        // Fallback-аккаунт разработчика для бесшовного дебага в браузере PC
        setUser({
          name: "@max_ceo (Разработчик)",
          photo: 'https://unsplash.com'
        });
      }
    } catch (error) {
      console.error('[🚨 TELEGRAM SDK CRASH]: Используется аварийный профиль.', error);
    }

    // Паттерн Event-Driven: Глобальный диспетчер переключения вкладок [проф. 1]
    const handleTabSwitch = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.tab) {
        setCurrentScreen(customEvent.detail.tab);
      }
    };

    window.addEventListener('onix.switch_tab', handleTabSwitch);
    return () => window.removeEventListener('onix.switch_tab', handleTabSwitch);
  }, []);

  return (
    <div style={{
      backgroundColor: '#000000',
      color: '#ffffff',
      minHeight: '100vh',
      fontFamily: '"Courier New", Courier, monospace, sans-serif',
      padding: '16px 16px 90px 16px',
      boxSizing: 'border-box',
      letterSpacing: '0.5px'
    }}>
      {/* BRAND HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ border: '2px solid #ffffff', padding: '6px 24px', fontSize: '22px', fontWeight: '900', letterSpacing: '4px' }}>
          O N I X
        </div>
        <div style={{ border: '1px solid #333', padding: '8px 12px', fontSize: '10px', color: '#888', fontWeight: 'bold' }}>
          {currentScreen.toUpperCase()} // USER: {user.name}
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #1c1c1c', marginBottom: '20px' }} />

      {/* VIEW ORCHESTRATION LAYER */}
      <main style={{ minHeight: 'calc(100vh - 160px)' }}>
        {currentScreen === 'market' && <MarketScreen />}
        {currentScreen === 'chat' && <ChatScreen />}
        {currentScreen === 'profile' && <ProfileScreen />}
        {currentScreen === 'create' && <CreateProductScreen />}
      </main>

      {/* FINTECH TAB-BAR MENU */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, height: '68px',
        backgroundColor: '#070707', borderTop: '1px solid #1c1c1c',
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
        padding: '0 12px', boxShadow: '0 -8px 25px rgba(0,0,0,0.5)', zIndex: 1000
      }}>
        {[
          { id: 'market', icon: 'Ὥ', label: 'РЫНОК' },
          { id: 'chat', icon: 'ὒ', label: 'ЧАТЫ' },
          { id: 'create', icon: '📦', label: 'ЛОТ' },
          { id: 'profile', icon: '⚙️', label: 'ПРОФИЛЬ' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              if (WebApp.initData) WebApp.HapticFeedback.impactOccurred('medium');
              setCurrentScreen(tab.id as any);
            }}
            style={{
              background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center',
              cursor: 'pointer', flex: 1, padding: '8px 0',
              color: currentScreen === tab.id ? '#ffffff' : '#333333',
              borderTop: currentScreen === tab.id ? '2px solid #ffffff' : '2px solid transparent',
              transition: 'all 0.15s ease', fontFamily: 'monospace'
            }}
          >
            <span style={{ fontSize: '20px', marginBottom: '3px', filter: currentScreen === tab.id ? 'none' : 'grayscale(100%)' }}>
              {tab.icon}
            </span>
            <span style={{ fontSize: '10px', fontWeight: currentScreen === tab.id ? '900' : 'normal' }}>
              {tab.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}