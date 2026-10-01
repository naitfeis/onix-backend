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

/**
 * Navigation is role-gated in one table instead of twelve inline conditions, so the
 * rule for a screen is readable at a glance and cannot drift from the render below.
 */
const NAV: Array<{ id: Screen; label: string; visibleTo: (role: string) => boolean }> = [
  { id: 'dashboard', label: 'Дашборд', visibleTo: () => true },
  { id: 'orders', label: 'Сделки', visibleTo: (role) => role !== 'FINANCE_ADMIN' },
  {
    id: 'support',
    label: 'Поддержка и безопасность',
    visibleTo: (role) => role === 'SUPER_ADMIN' || role === 'SUPPORT_ADMIN' || role === 'SECURITY_ADMIN',
  },
  { id: 'products', label: 'Лоты', visibleTo: (role) => role !== 'FINANCE_ADMIN' },
  { id: 'messages', label: 'Чаты', visibleTo: (role) => role !== 'FINANCE_ADMIN' },
  { id: 'audit', label: 'Аудит', visibleTo: () => true },
  {
    id: 'flags',
    label: 'Алерты',
    visibleTo: (role) => role === 'SUPER_ADMIN' || role === 'SECURITY_ADMIN',
  },
  { id: 'withdrawals', label: 'Выводы', visibleTo: (role) => role !== 'SUPPORT_ADMIN' },
  {
    id: 'payments',
    label: 'Платежи',
    visibleTo: (role) => role === 'SUPER_ADMIN' || role === 'FINANCE_ADMIN',
  },
  { id: 'users', label: 'Пользователи / баны', visibleTo: (role) => role !== 'FINANCE_ADMIN' },
  { id: 'staff', label: 'Сотрудники', visibleTo: (role) => role === 'SUPER_ADMIN' },
  {
    id: 'risk',
    label: 'Центр риска',
    visibleTo: (role) => role === 'SUPER_ADMIN' || role === 'SECURITY_ADMIN' || role === 'SUPPORT_ADMIN',
  },
];

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
        {NAV.filter((item) => item.visibleTo(admin.role)).map((item) => (
          <button
            key={item.id}
            type="button"
            className={screen === item.id ? 'active' : ''}
            onClick={() => setScreen(item.id)}
          >
            {item.label}
          </button>
        ))}
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