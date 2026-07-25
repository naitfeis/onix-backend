import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type Dashboard = {
  windowHours: number;
  withdrawals24h: number;
  securityEvents24h: number;
  openClawbacks: number;
  yellowFlagCount: number;
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
      <h2>Security Operations Console</h2>
      <p className="muted">Live risk posture for the marketplace ({data?.windowHours ?? 24}h window).</p>
      {error && <p className="error">{error}</p>}
      {data && (
        <div className="grid">
          <div className="stat panel"><span className="muted">YELLOW flags</span><strong>{data.yellowFlagCount}</strong></div>
          <div className="stat panel"><span className="muted">Withdrawals 24h</span><strong>{data.withdrawals24h}</strong></div>
          <div className="stat panel"><span className="muted">Risk events 24h</span><strong>{data.securityEvents24h}</strong></div>
          <div className="stat panel"><span className="muted">Open clawbacks</span><strong>{data.openClawbacks}</strong></div>
        </div>
      )}
    </div>
  );
}
