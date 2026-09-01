import { useEffect, useState } from 'react';
import { adminApi, clearAdminToken, getAdminToken, setAdminToken } from './api/client';
import { LoginScreen } from './screens/LoginScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { SecurityFlagsScreen } from './screens/SecurityFlagsScreen';
import { WithdrawalsScreen } from './screens/WithdrawalsScreen';
import { UsersScreen } from './screens/UsersScreen';
import { RiskEventsScreen } from './screens/RiskEventsScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { AuditLogScreen } from './screens/AuditLogScreen';
import { SupportScreen } from './screens/SupportScreen';
import { ProductsScreen } from './screens/ProductsScreen';
import { MessagesScreen } from './screens/MessagesScreen';
import { PaymentsScreen } from './screens/PaymentsScreen';
import { ChatThreadModal } from './screens/ChatThreadModal';

type AdminMe = { id: string; email: string; role: string; sessionId?: string };
function adminRoleLabel(role: string) { return role === 'SUPER_ADMIN' ? 'FOUNDER' : role; }
type Screen = 'dashboard' | 'orders' | 'support' | 'products' | 'messages' | 'audit' | 'flags' | 'withdrawals' | 'users' | 'risk' | 'payments';

export function App() {
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [chatId, setChatId] = useState<string | null>(null);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      void adminApi<{ accessToken: string; admin: AdminMe }>('/api/admin/auth/refresh', {
        method: 'POST',
      })
        .then((result) => {
          setAdminToken(result.accessToken);
          setAdmin(result.admin);
        })
        .catch(() => {
          clearAdminToken();
          setAdmin(null);
        })
        .finally(() => setBooting(false));
      return;
    }
    void adminApi<AdminMe>('/api/admin/me')
      .then((me) => setAdmin(me))
      .catch(() => {
        clearAdminToken();
        setAdmin(null);
      })
      .finally(() => setBooting(false));
  }, []);

  if (booting) {
    return <div className="login-wrap"><p className="muted">Загрузка…</p></div>;
  }

  if (!admin) {
    return (
      <LoginScreen
        onAuthed={(accessToken, me) => {
          setAdminToken(accessToken);
          setAdmin(me);
          setScreen('dashboard');
        }}
      />
    );
  }

  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        <h1>ONIX Admin</h1>
        <p className="muted" style={{ marginBottom: '1rem' }}>{admin.email}<br />{adminRoleLabel(admin.role)}</p>
        <button type="button" className={screen === 'dashboard' ? 'active' : ''} onClick={() => setScreen('dashboard')}>Дашборд</button>
        {admin.role !== 'FINANCE_ADMIN' && <button type="button" className={screen === 'orders' ? 'active' : ''} onClick={() => setScreen('orders')}>Сделки</button>}
        {(admin.role === 'SUPER_ADMIN' || admin.role === 'SUPPORT_ADMIN') && <button type="button" className={screen === 'support' ? 'active' : ''} onClick={() => setScreen('support')}>Тикеты и жалобы</button>}
        {admin.role !== 'FINANCE_ADMIN' && <button type="button" className={screen === 'products' ? 'active' : ''} onClick={() => setScreen('products')}>Лоты</button>}
        {admin.role !== 'FINANCE_ADMIN' && <button type="button" className={screen === 'messages' ? 'active' : ''} onClick={() => setScreen('messages')}>Чаты</button>}
        <button type="button" className={screen === 'audit' ? 'active' : ''} onClick={() => setScreen('audit')}>Аудит</button>
        {(admin.role === 'SUPER_ADMIN' || admin.role === 'SECURITY_ADMIN') && <button type="button" className={screen === 'flags' ? 'active' : ''} onClick={() => setScreen('flags')}>Алерты</button>}
        {admin.role !== 'SUPPORT_ADMIN' && <button type="button" className={screen === 'withdrawals' ? 'active' : ''} onClick={() => setScreen('withdrawals')}>Выводы</button>}
        {(admin.role === 'SUPER_ADMIN' || admin.role === 'FINANCE_ADMIN') && <button type="button" className={screen === 'payments' ? 'active' : ''} onClick={() => setScreen('payments')}>Платежи</button>}
        {admin.role !== 'FINANCE_ADMIN' && <button type="button" className={screen === 'users' ? 'active' : ''} onClick={() => setScreen('users')}>Пользователи / баны</button>}
        {(admin.role === 'SUPER_ADMIN' || admin.role === 'SECURITY_ADMIN') && <button type="button" className={screen === 'risk' ? 'active' : ''} onClick={() => setScreen('risk')}>Риск</button>}
        <div style={{ marginTop: '1.5rem' }}>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void adminApi('/api/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
              clearAdminToken();
              setAdmin(null);
            }}
          >
            Logout
          </button>
        </div>
      </nav>
      <main className="admin-main">
        {screen === 'dashboard' && <DashboardScreen />}
        {screen === 'orders' && <OrdersScreen onOpenChat={setChatId} />}
        {screen === 'support' && <SupportScreen onOpenChat={setChatId} />}
        {screen === 'products' && <ProductsScreen />}
        {screen === 'messages' && <MessagesScreen onOpenChat={setChatId} />}
        {screen === 'audit' && <AuditLogScreen />}
        {screen === 'flags' && <SecurityFlagsScreen />}
        {screen === 'withdrawals' && <WithdrawalsScreen />}
        {screen === 'payments' && <PaymentsScreen />}
        {screen === 'users' && <UsersScreen adminRole={admin.role} onOpenChat={setChatId} />}
        {screen === 'risk' && <RiskEventsScreen />}
        {chatId && <ChatThreadModal chatId={chatId} onClose={() => setChatId(null)} />}
      </main>
    </div>
  );
}