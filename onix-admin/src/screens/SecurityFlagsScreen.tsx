import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type Flag = {
  code?: string;
  onixId?: string;
  userId?: string;
  reason?: string;
  severity?: string;
  createdAt?: string;
  status?: string;
  restrictedAccountSaleCents?: string;
  protectionUntil?: string;
};

export function SecurityFlagsScreen() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<{ flags: Flag[] }>('/api/admin/security-flags')
      .then((data) => setFlags(data.flags ?? []))
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Failed'));
  }, []);

  return (
    <div className="panel">
      <h2>Security Alerts (YELLOW)</h2>
      <p className="muted">Account-sale / velocity protection and related flags.</p>
      {error && <p className="error">{error}</p>}
      {!error && flags.length === 0 && <p className="muted">No open flags.</p>}
      {flags.map((f, i) => (
        <div key={`${f.onixId ?? f.userId ?? 'flag'}-${i}`} className="flag">
          <strong>{f.onixId || f.userId || '—'}</strong>
          <div className="muted">
            {f.code || f.reason || 'flag'} · {f.severity || 'YELLOW'}
            {f.createdAt ? ` · ${new Date(f.createdAt).toLocaleString()}` : ''}
          </div>
          {f.restrictedAccountSaleCents && (
            <div className="muted">Restricted ACCOUNT cents: {f.restrictedAccountSaleCents}</div>
          )}
        </div>
      ))}
    </div>
  );
}
