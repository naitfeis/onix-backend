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
import { StaffScreen } from './screens/StaffScreen';
import { ChatThreadModal } from './screens/ChatThreadModal';

type AdminMe = {
  id: string;
  email: string;
  role: string;
  sessionId?: string;
  clientIp?: string | null;
  ipAllowlistConfigured?: boolean;
};
function adminRoleLabel(role: string) {
  return ({
    SUPER_ADMIN: 'Основатель',
    SECURITY_ADMIN: 'Безопасность',
    SUPPORT_ADMIN: 'Поддержка',
    FINANCE_ADMIN: 'Финансы',
  } as Record<string, string>)[role] ?? role;
}
type Screen = 'dashboard' | 'orders' | 'support' | 'products' | 'messages' | 'audit' | 'flags' | 'withdrawals' | 'users' | 'risk' | 'payments' | 'staff';

export function App() {
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [chatId, setChatId] = useState<string | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [openProductId, setOpenProductId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const token = getAdminToken();
        if (token) {
          try {
            const me = await adminApi<AdminMe>('/api/admin/me');
            if (!cancelled) setAdmin(me);
            return;
          } catch {
            clearAdminToken();
          }
        }
        try {
          const result = await adminApi<{ accessToken: string; admin: AdminMe }>('/api/admin/auth/refresh', {
            method: 'POST',
          });
          if (cancelled) return;
          setAdminToken(result.accessToken);
          setAdmin(result.admin);
          return;
        } catch {
          if (!cancelled) {
            clearAdminToken();
            setAdmin(null);
          }
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    }
    void boot();
    return () => { cancelled = true; };
  }, []);

  if (booting) {
    return <div className="login-wrap"><p className="muted">Загрузка…</p></div>;
  }

  if (!admin) {
    return (
      <LoginScreen
        onAuthed={async (accessToken, me) => {
          setAdminToken(accessToken);
          try {
            const full = await adminApi<AdminMe>('/api/admin/me');
            setAdmin(full);
          } catch {
            setAdmin(me);
          }
          setScreen('dashboard');
        }}
      />
    );
  }

  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        <h1>Админ ONIX</h1>
        <p className="muted" style={{ marginBottom: '1rem' }}>{admin.email}<br />{adminRoleLabel(admin.role)}</p>
        <button type="button" className={screen === 'dashboard' ? 'active' : ''} onClick={() => setScreen('dashboard')}>Дашборд</button>
        {admin.role !== 'FINANCE_ADMIN' && <button type="button" className={screen === 'orders' ? 'active' : ''} onClick={() => setScreen('orders')}>Сделки</button>}
        {(admin.role === 'SUPER_ADMIN' || admin.role === 'SUPPORT_ADMIN' || admin.role === 'SECURITY_ADMIN') && <button type="button" className={screen === 'support' ? 'active' : ''} onClick={() => setScreen('support')}>Поддержка и безопасность</button>}
        {admin.role !== 'FINANCE_ADMIN' && <button type="button" className={screen === 'products' ? 'active' : ''} onClick={() => setScreen('products')}>Лоты</button>}
        {admin.role !== 'FINANCE_ADMIN' && <button type="button" className={screen === 'messages' ? 'active' : ''} onClick={() => setScreen('messages')}>Чаты</button>}
        <button type="button" className={screen === 'audit' ? 'active' : ''} onClick={() => setScreen('audit')}>Аудит</button>
        {(admin.role === 'SUPER_ADMIN' || admin.role === 'SECURITY_ADMIN') && <button type="button" className={screen === 'flags' ? 'active' : ''} onClick={() => setScreen('flags')}>Алерты</button>}
        {admin.role !== 'SUPPORT_ADMIN' && <button type="button" className={screen === 'withdrawals' ? 'active' : ''} onClick={() => setScreen('withdrawals')}>Выводы</button>}
        {(admin.role === 'SUPER_ADMIN' || admin.role === 'FINANCE_ADMIN') && <button type="button" className={screen === 'payments' ? 'active' : ''} onClick={() => setScreen('payments')}>Платежи</button>}
        {admin.role !== 'FINANCE_ADMIN' && <button type="button" className={screen === 'users' ? 'active' : ''} onClick={() => setScreen('users')}>Пользователи / баны</button>}
        {admin.role === 'SUPER_ADMIN' && <button type="button" className={screen === 'staff' ? 'active' : ''} onClick={() => setScreen('staff')}>Сотрудники</button>}
        {(admin.role === 'SUPER_ADMIN' || admin.role === 'SECURITY_ADMIN' || admin.role === 'SUPPORT_ADMIN') && <button type="button" className={screen === 'risk' ? 'active' : ''} onClick={() => setScreen('risk')}>Центр риска</button>}
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
            Выйти
          </button>
        </div>
      </nav>
      <main className="admin-main">
        {screen === 'dashboard' && <DashboardScreen />}
        {screen === 'orders' && (
          <OrdersScreen
            onOpenChat={setChatId}
            onOpenLot={(id) => { setOpenProductId(id); setScreen('products'); }}
            onOpenUser={(id) => { setOpenUserId(id); setScreen('users'); }}
          />
        )}
        {screen === 'support' && <SupportScreen onOpenChat={setChatId} />}
        {screen === 'products' && (
          <ProductsScreen
            initialId={openProductId}
            onOpenSeller={(id) => { setOpenUserId(id); setScreen('users'); }}
          />
        )}
        {screen === 'messages' && <MessagesScreen onOpenChat={setChatId} />}
        {screen === 'audit' && <AuditLogScreen />}
        {screen === 'flags' && <SecurityFlagsScreen />}
        {screen === 'withdrawals' && <WithdrawalsScreen />}
        {screen === 'payments' && <PaymentsScreen />}
        {screen === 'users' && (
          <UsersScreen adminRole={admin.role} onOpenChat={setChatId} initialOnixId={openUserId} />
        )}
        {screen === 'staff' && admin.role === 'SUPER_ADMIN' && (
          <StaffScreen clientIp={admin.clientIp} ipAllowlistConfigured={admin.ipAllowlistConfigured} />
        )}
        {screen === 'risk' && (
          <RiskEventsScreen onOpenUser={(id) => { setOpenUserId(id); setScreen('users'); }} />
        )}
        {chatId && <ChatThreadModal chatId={chatId} onClose={() => setChatId(null)} />}
      </main>
    </div>
  );
}