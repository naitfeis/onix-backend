import { useEffect, useState } from 'react';
import { adminApi, clearAdminToken, getAdminToken, setAdminToken } from './api/client';
import { LoginScreen } from './screens/LoginScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { SecurityFlagsScreen } from './screens/SecurityFlagsScreen';
import { WithdrawalsScreen } from './screens/WithdrawalsScreen';
import { UserInvestigateScreen } from './screens/UserInvestigateScreen';
import { RiskEventsScreen } from './screens/RiskEventsScreen';

type AdminMe = { id: string; email: string; role: string; sessionId?: string };
type Screen = 'dashboard' | 'flags' | 'withdrawals' | 'users' | 'risk';

export function App() {
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState<Screen>('dashboard');

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      setBooting(false);
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
    return <div className="login-wrap"><p className="muted">Loading…</p></div>;
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
        <p className="muted" style={{ marginBottom: '1rem' }}>{admin.email}<br />{admin.role}</p>
        <button type="button" className={screen === 'dashboard' ? 'active' : ''} onClick={() => setScreen('dashboard')}>Dashboard</button>
        <button type="button" className={screen === 'flags' ? 'active' : ''} onClick={() => setScreen('flags')}>Security Alerts</button>
        <button type="button" className={screen === 'withdrawals' ? 'active' : ''} onClick={() => setScreen('withdrawals')}>Withdrawals</button>
        <button type="button" className={screen === 'users' ? 'active' : ''} onClick={() => setScreen('users')}>User Investigate</button>
        <button type="button" className={screen === 'risk' ? 'active' : ''} onClick={() => setScreen('risk')}>Risk Events</button>
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
        {screen === 'flags' && <SecurityFlagsScreen />}
        {screen === 'withdrawals' && <WithdrawalsScreen />}
        {screen === 'users' && <UserInvestigateScreen />}
        {screen === 'risk' && <RiskEventsScreen />}
      </main>
    </div>
  );
}
