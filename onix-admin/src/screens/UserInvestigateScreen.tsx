import { FormEvent, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type Investigation = {
  profile: {
    id: string;
    onixId: string;
    username?: string | null;
    createdAt: string;
    accountAgeDays: number;
    trustScore?: number;
    trustLevel?: number;
    securityScore?: number;
    balanceCents: string;
    platformStatus?: string;
    bannedAt?: string | null;
  };
  flags: Array<Record<string, unknown>>;
  securityEvents: Array<{ id: string; type: string; severity?: string; createdAt: string }>;
  ledger: Array<{ id: string; type: string; amountCents: string; createdAt: string; fundKind?: string | null; saleKind?: string | null }>;
};

export function UserInvestigateScreen() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setData(null);
    try {
      const result = await adminApi<Investigation>(`/api/admin/users/${encodeURIComponent(query.trim())}`);
      setData(result);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>User Investigate</h2>
      <form className="row" onSubmit={onSubmit}>
        <label>ONIX ID or user id
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ONIX-…" required />
        </label>
        <button className="primary" type="submit" disabled={busy}>{busy ? '…' : 'Load'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <p>
            <strong>{data.profile.onixId}</strong>
            {' · '}
            {data.profile.username || '—'}
            {' · '}
            age {data.profile.accountAgeDays}d
            {' · '}
            {data.profile.bannedAt ? 'BANNED' : (data.profile.platformStatus || 'active')}
          </p>
          <p className="muted">Balance {data.profile.balanceCents}¢ · trust L{data.profile.trustLevel ?? '—'} / {data.profile.trustScore ?? '—'}</p>
          <h3>Flags</h3>
          {data.flags.length === 0 ? <p className="muted">None</p> : data.flags.map((f, i) => (
            <div key={i} className="flag"><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(f, null, 2)}</pre></div>
          ))}
          <h3>Security events</h3>
          <table>
            <thead><tr><th>Type</th><th>Severity</th><th>When</th></tr></thead>
            <tbody>
              {data.securityEvents.map((e) => (
                <tr key={e.id}><td>{e.type}</td><td>{e.severity || '—'}</td><td>{new Date(e.createdAt).toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
          <h3>Ledger</h3>
          <table>
            <thead><tr><th>Type</th><th>Amount</th><th>Fund/Sale</th><th>When</th></tr></thead>
            <tbody>
              {data.ledger.map((w) => (
                <tr key={w.id}>
                  <td>{w.type}</td>
                  <td>{w.amountCents}</td>
                  <td>{[w.fundKind, w.saleKind].filter(Boolean).join('/') || '—'}</td>
                  <td>{new Date(w.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
