import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type RiskEvent = {
  id: string;
  type: string;
  severity: number;
  level: string;
  status: string;
  createdAt: string;
  country?: string | null;
  ipAddress?: string | null;
  reasons: string[];
  action: string;
  payload: Record<string, unknown>;
  user: {
    id: string;
    onixId: string;
    username?: string | null;
    caseId?: string | null;
    locked: boolean;
    lockLevel?: string | null;
  } | null;
};

type Center = {
  counts: { critical: number; high: number; medium: number; low: number };
  events: RiskEvent[];
};

export function RiskEventsScreen() {
  const [data, setData] = useState<Center | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<Center>('/api/admin/risk/center')
      .then(setData)
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Failed'));
  }, []);

  const selected = data?.events.find((e) => e.id === openId) ?? null;

  return (
    <div className="panel">
      <h2>Risk Center</h2>
      <div className="grid">
        <div className="stat"><span>Critical</span><strong>{data?.counts.critical ?? '—'}</strong></div>
        <div className="stat"><span>High</span><strong>{data?.counts.high ?? '—'}</strong></div>
        <div className="stat"><span>Medium</span><strong>{data?.counts.medium ?? '—'}</strong></div>
        <div className="stat"><span>Low</span><strong>{data?.counts.low ?? '—'}</strong></div>
      </div>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Risk</th>
            <th>Event</th>
            <th>Action</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {(data?.events ?? []).map((e) => (
            <tr key={e.id} className="click-row" onClick={() => setOpenId(e.id)}>
              <td>{e.user?.onixId || '—'}</td>
              <td>{e.level} ({e.severity})</td>
              <td>{e.type}</td>
              <td>{e.action}</td>
              <td>{new Date(e.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && (
        <div className="admin-modal" onClick={() => setOpenId(null)}>
          <div className="admin-modal__panel" onClick={(ev) => ev.stopPropagation()}>
            <h2>{selected.user?.onixId || 'User'}</h2>
            <p>Risk: {selected.level} · Event: {selected.type} · Action: {selected.action}</p>
            {selected.user?.caseId && <p>ID дела: {selected.user.caseId}</p>}
            <h3>Причины</h3>
            <ul>
              {(selected.reasons.length ? selected.reasons : ['нет детализации']).map((r) => <li key={r}>{r}</li>)}
            </ul>
            <h3>Связанные сущности</h3>
            <ul className="muted">
              <li>User: {selected.user?.onixId || '—'}</li>
              <li>Case: {selected.user?.caseId || '—'}</li>
              <li>Lock: {selected.user?.locked ? (selected.user.lockLevel || 'YES') : 'no'}</li>
              <li>Order: {String((selected.payload.related as { orderId?: string } | undefined)?.orderId || '—')}</li>
              <li>Listing: {String((selected.payload.related as { listingId?: string } | undefined)?.listingId || '—')}</li>
              <li>Chat: {String((selected.payload.related as { chatId?: string } | undefined)?.chatId || '—')}</li>
              <li>Device/IP: {selected.ipAddress || '—'} {selected.country ? `(${selected.country})` : ''}</li>
            </ul>
            <h3>Контекст</h3>
            <pre><code>{JSON.stringify(selected.payload, null, 2)}</code></pre>
            <button className="ghost" type="button" onClick={() => setOpenId(null)}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}
