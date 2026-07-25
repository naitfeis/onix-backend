import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type RiskEvent = {
  id: string;
  type: string;
  severity?: string;
  userId?: string | null;
  createdAt: string;
  country?: string | null;
  ipAddress?: string | null;
};

export function RiskEventsScreen() {
  const [items, setItems] = useState<RiskEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<{ events: RiskEvent[] }>('/api/admin/risk/events')
      .then((data) => setItems(data.events ?? []))
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Failed'));
  }, []);

  return (
    <div className="panel">
      <h2>Risk Events</h2>
      <p className="muted">Recent security-event stream.</p>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Severity</th>
            <th>User</th>
            <th>When</th>
            <th>Geo</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>{e.type}</td>
              <td>{e.severity || '—'}</td>
              <td>{e.userId || '—'}</td>
              <td>{new Date(e.createdAt).toLocaleString()}</td>
              <td>{e.country || e.ipAddress || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
