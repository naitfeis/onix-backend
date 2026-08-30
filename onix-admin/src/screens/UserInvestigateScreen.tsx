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
    bannedUntil?: string | null;
    sellBannedAt?: string | null;
  };
  flags: Array<Record<string, unknown>>;
  securityEvents: Array<{ id: string; type: string; severity?: string; createdAt: string }>;
  ledger: Array<{ id: string; type: string; amountCents: string; createdAt: string; fundKind?: string | null; saleKind?: string | null }>;
  sales: Array<{ id: string; status: string; totalAmountCents: string; payoutCents: string; createdAt: string; productId: string }>;
  purchases: Array<{ id: string; status: string; totalAmountCents: string; createdAt: string; product: { title: string }; seller: { onixId: string } }>;
  chats: Array<{ id: string; kind: string; title?: string | null; updatedAt: string; memberIds: string[]; lastMessage?: { text: string; createdAt: string } | null }>;
};

export function UserInvestigateScreen({ adminRole }: { adminRole: string }) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [reason, setReason] = useState('MISCONDUCT');
  const [comment, setComment] = useState('');
  const [days, setDays] = useState('');
  const [status, setStatus] = useState('USER');
  const [balance, setBalance] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setData(null);
    setStatus('USER');
    try {
      const result = await adminApi<Investigation>(`/api/admin/users/${encodeURIComponent(query.trim())}`);
      setData(result);
      setStatus(result.profile.platformStatus || 'USER');
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function action(path: string, init: RequestInit) {
    setActionBusy(true); setError(null);
    try { await adminApi(path, init); await onSubmit({ preventDefault() {} } as FormEvent); }
    catch (err) { setError(err instanceof AdminApiError ? err.message : 'Action failed'); }
    finally { setActionBusy(false); }
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
          <div className="admin-actions">
            <h3>Moderation controls</h3>
            <div className="row"><label>Ban reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="MISCONDUCT">Misconduct</option><option value="THIRD_PARTY_ADS">Third-party ads</option><option value="OFF_PLATFORM_DEAL">Off-platform deal</option><option value="FRAUD">Fraud</option><option value="OTHER">Other</option></select></label><label>Duration days<input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" /></label></div>
            <label>Public reason / comment<textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} required /></label>
            <div className="row"><button className="danger" type="button" disabled={actionBusy} onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/ban`, { method: 'PATCH', body: JSON.stringify({ reason, comment, ...(days ? { durationDays: Number(days) } : {}) }) })}>Ban account</button><button className="ghost" type="button" disabled={actionBusy} onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/sell-ban`, { method: 'PATCH', body: JSON.stringify({ banned: !data.profile.sellBannedAt, comment }) })}>{data.profile.sellBannedAt ? 'Allow sales' : 'Ban sales'}</button></div>
            <div className="row">
              {adminRole === 'SUPER_ADMIN' && (
                <>
                  <label>Platform status<select value={status} onChange={(e) => setStatus(e.target.value)}><option>USER</option><option>VERIFIED_SELLER</option><option>MODERATOR</option><option>ADMIN</option><option>SUPER_ADMIN</option><option>VIP</option></select></label>
                  <button className="primary" type="button" disabled={actionBusy || status === data.profile.platformStatus} onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })}>Set status</button>
                </>
              )}
              <label>Balance adjustment (cents)<input value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="1000 or -1000" /></label><button className="primary" type="button" disabled={actionBusy || !balance} onClick={() => void action(`/api/admin/users/${encodeURIComponent(data.profile.onixId)}/balance`, { method: 'POST', body: JSON.stringify({ amountCents: balance, reason: comment, idempotencyKey: `admin-${Date.now()}-${Math.random().toString(36).slice(2)}` }) })}>Adjust balance</button>
            </div>
          </div>
          <p className="muted">Balance {data.profile.balanceCents}¢ · trust L{data.profile.trustLevel ?? '—'} / {data.profile.trustScore ?? '—'}</p>
          <h3>Purchases</h3>
          <table><thead><tr><th>ID</th><th>Product</th><th>Seller</th><th>Status</th><th>Amount</th></tr></thead><tbody>{data.purchases.map((o) => <tr key={o.id}><td>#{o.id}</td><td>{o.product.title}</td><td>{o.seller.onixId}</td><td>{o.status}</td><td>{o.totalAmountCents}?</td></tr>)}</tbody></table>
          <h3>Sales</h3>
          <table><thead><tr><th>ID</th><th>Product</th><th>Status</th><th>Total</th><th>Payout</th></tr></thead><tbody>{data.sales.map((o) => <tr key={o.id}><td>#{o.id}</td><td>{o.productId}</td><td>{o.status}</td><td>{o.totalAmountCents}?</td><td>{o.payoutCents}?</td></tr>)}</tbody></table>
          <h3>User chats</h3>
          <table><thead><tr><th>Chat</th><th>Members</th><th>Last message</th><th>Updated</th></tr></thead><tbody>{data.chats.map((c) => <tr key={c.id}><td>{c.title || c.kind}<br/><span className="muted">{c.id}</span></td><td>{c.memberIds.join(', ')}</td><td>{c.lastMessage?.text || '-'}</td><td>{new Date(c.updatedAt).toLocaleString()}</td></tr>)}</tbody></table>
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
