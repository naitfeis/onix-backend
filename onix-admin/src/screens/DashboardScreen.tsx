import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type Dashboard = {
  windowHours: number;
  withdrawals24h: number;
  securityEvents24h: number;
  openClawbacks: number;
  yellowFlagCount: number;
  openTickets?: number;
  openReports?: number;
  usersTotal?: number;
  bannedTotal?: number;
};

export function DashboardScreen() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<Dashboard>('/api/admin/dashboard')
      .then(setData)
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Failed'));
  }, []);

  return (
    <div className="panel">
      <h2>Консоль ONIX</h2>
      <p className="muted">Операции, жалобы, деньги и риск за {data?.windowHours ?? 24}ч.</p>
      {error && <p className="error">{error}</p>}
      {data && (
        <div className="grid">
          <div className="stat panel"><span className="muted">Пользователи</span><strong>{data.usersTotal ?? '—'}</strong></div>
          <div className="stat panel"><span className="muted">Баны / стёртые</span><strong>{data.bannedTotal ?? '—'}</strong></div>
          <div className="stat panel"><span className="muted">Открытые тикеты</span><strong>{data.openTickets ?? '—'}</strong></div>
          <div className="stat panel"><span className="muted">Жалобы</span><strong>{data.openReports ?? '—'}</strong></div>
          <div className="stat panel"><span className="muted">YELLOW флаги</span><strong>{data.yellowFlagCount}</strong></div>
          <div className="stat panel"><span className="muted">Выводы 24ч</span><strong>{data.withdrawals24h}</strong></div>
          <div className="stat panel"><span className="muted">Риск 24ч</span><strong>{data.securityEvents24h}</strong></div>
          <div className="stat panel"><span className="muted">Clawbacks</span><strong>{data.openClawbacks}</strong></div>
        </div>
      )}
    </div>
  );
}
