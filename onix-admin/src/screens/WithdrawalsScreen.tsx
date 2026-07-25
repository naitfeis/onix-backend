import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type Withdrawal = {
  id: string;
  onixId?: string;
  userId?: string;
  amountRub?: string;
  amountCents?: string;
  status: string;
  flag?: string | null;
  createdAt: string;
  fundKind?: string | null;
  saleKind?: string | null;
};

export function WithdrawalsScreen() {
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<{ withdrawals: Withdrawal[] }>('/api/admin/withdrawals')
      .then((data) => setItems(data.withdrawals ?? []))
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Failed'));
  }, []);

  return (
    <div className="panel">
      <h2>Withdrawals</h2>
      <p className="muted">Recent withdrawal ledger entries + review status.</p>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>User</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Flag</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <tr key={w.id}>
              <td>{w.id.slice(0, 8)}…</td>
              <td>{w.onixId || w.userId || '—'}</td>
              <td>{w.amountRub ?? w.amountCents ?? '—'}</td>
              <td>{w.status}</td>
              <td>{w.flag || '—'}</td>
              <td>{new Date(w.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
