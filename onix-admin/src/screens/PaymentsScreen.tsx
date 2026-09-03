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

function money(cents: string) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return cents;
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n / 100);
}

function ruWallet(wallet: string) {
  return wallet === 'DEPOSIT' ? 'залог' : 'основной баланс';
}

function ruPayStatus(status: string) {
  return ({
    PENDING: 'ожидает',
    SUCCEEDED: 'зачислен',
    FAILED: 'ошибка',
    CANCELED: 'отменён',
  } as Record<string, string>)[status] ?? status;
}

export function PaymentsScreen() {
  const [target, setTarget] = useState('');
  const [wallet, setWallet] = useState<'MAIN' | 'DEPOSIT'>('MAIN');
  const [amountRub, setAmountRub] = useState('');
  const [intent, setIntent] = useState<ManualIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createIntent(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const rub = Number(amountRub.replace(',', '.'));
      const amountCents = Math.round(rub * 100);
      const created = await adminApi<ManualIntent>(
        `/api/admin/users/${encodeURIComponent(target.trim())}/payments/manual`,
        {
          method: 'POST',
          body: JSON.stringify({
            wallet,
            amountCents,
            idempotencyKey: `admin-manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          }),
        },
      );
      setIntent(created);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Не удалось создать платёж');
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
      setError(err instanceof AdminApiError ? err.message : 'Не удалось подтвердить платёж');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Ручное пополнение</h2>
      <p className="muted">Создайте ожидающее пополнение и подтвердите его отдельно.</p>
      <form onSubmit={createIntent}>
        <div className="row">
          <label>ID пользователя
            <input value={target} onChange={(event) => setTarget(event.target.value)} required />
          </label>
          <label>Кошелёк
            <select value={wallet} onChange={(event) => setWallet(event.target.value as 'MAIN' | 'DEPOSIT')}>
              <option value="MAIN">Основной баланс</option>
              <option value="DEPOSIT">Залог</option>
            </select>
          </label>
          <label>Сумма, ₽
            <input
              value={amountRub}
              onChange={(event) => setAmountRub(event.target.value)}
              inputMode="decimal"
              min="1"
              type="number"
              required
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>Создать</button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      {intent && (
        <div className="admin-actions">
          <p>
            {ruWallet(intent.wallet)} · {money(intent.amountCents)} · {ruPayStatus(intent.status)}
          </p>
          <button
            className="primary"
            type="button"
            disabled={busy || intent.status === 'SUCCEEDED'}
            onClick={() => void confirmIntent()}
          >
            Подтвердить зачисление
          </button>
        </div>
      )}
    </div>
  );
}
