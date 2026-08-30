import { FormEvent, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type ManualIntent = {
  id: string;
  userId: string;
  wallet: 'MAIN' | 'DEPOSIT';
  amountCents: string;
  status: string;
  provider: 'MANUAL';
};

export function PaymentsScreen() {
  const [target, setTarget] = useState('');
  const [wallet, setWallet] = useState<'MAIN' | 'DEPOSIT'>('MAIN');
  const [amountCents, setAmountCents] = useState('');
  const [intent, setIntent] = useState<ManualIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createIntent(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await adminApi<ManualIntent>(
        `/api/admin/users/${encodeURIComponent(target.trim())}/payments/manual`,
        {
          method: 'POST',
          body: JSON.stringify({
            wallet,
            amountCents: Number(amountCents),
            idempotencyKey: `admin-manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          }),
        },
      );
      setIntent(created);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Failed to create payment intent');
    } finally {
      setBusy(false);
    }
  }

  async function confirmIntent() {
    if (!intent) return;
    setBusy(true);
    setError(null);
    try {
      const confirmed = await adminApi<ManualIntent>(
        `/api/admin/payments/intents/${encodeURIComponent(intent.id)}/confirm`,
        { method: 'POST' },
      );
      setIntent(confirmed);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Failed to confirm payment intent');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Manual Payments</h2>
      <p className="muted">Create a pending MANUAL top-up for a customer, then confirm it explicitly.</p>
      <form onSubmit={createIntent}>
        <div className="row">
          <label>ONIX ID or user id
            <input value={target} onChange={(event) => setTarget(event.target.value)} required />
          </label>
          <label>Wallet
            <select value={wallet} onChange={(event) => setWallet(event.target.value as 'MAIN' | 'DEPOSIT')}>
              <option value="MAIN">Main balance</option>
              <option value="DEPOSIT">Deposit</option>
            </select>
          </label>
          <label>Amount (cents)
            <input
              value={amountCents}
              onChange={(event) => setAmountCents(event.target.value)}
              inputMode="numeric"
              min="100"
              type="number"
              required
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>Create intent</button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      {intent && (
        <div className="admin-actions">
          <p><strong>{intent.id}</strong> · user {intent.userId} · {intent.wallet} · {intent.amountCents}¢ · {intent.status}</p>
          <button
            className="primary"
            type="button"
            disabled={busy || intent.status === 'SUCCEEDED'}
            onClick={() => void confirmIntent()}
          >
            Confirm MANUAL payment
          </button>
        </div>
      )}
    </div>
  );
}
