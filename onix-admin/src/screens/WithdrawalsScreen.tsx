import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';
import { EmptyRows } from '../components/EmptyRows';

type Withdrawal = {
  id: string;
  onixId?: string;
  userId?: string;
  amountRub?: string;
  amountCents?: string;
  status: string;
  provider?: string;
  riskReasons?: string[] | null;
  reviewReason?: string | null;
  refundLedgerEntryId?: string | null;
  createdAt: string;
};

function money(cents?: string) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return cents ?? '—';
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n / 100);
}

function ruStatus(status: string) {
  return ({
    PENDING: 'ожидает',
    REQUESTED: 'запрошен',
    RISK_REVIEW: 'риск-проверка',
    APPROVED: 'одобрен',
    PROCESSING: 'обрабатывается',
    MANUAL_REVIEW: 'ручная проверка',
    REJECTED: 'отклонён',
    PAID: 'выплачен',
    FAILED: 'ошибка',
  } as Record<string, string>)[status] ?? status;
}

export function WithdrawalsScreen() {
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => adminApi<{ withdrawals: Withdrawal[] }>('/api/admin/withdrawals')
      .then((data) => setItems(data.withdrawals ?? []))
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Не удалось загрузить'));

  useEffect(() => { void load(); }, []);

  async function decide(item: Withdrawal, decision: 'approve' | 'reject') {
    const reason = window.prompt(
      decision === 'approve' ? 'Причина одобрения' : 'Причина отклонения и возврата средств',
    )?.trim();
    if (!reason) return;
    setBusyId(item.id);
    setError(null);
    try {
      await adminApi(`/api/admin/withdrawals/${encodeURIComponent(item.id)}/${decision}`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Операция не выполнена');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="panel">
      <h2>Выводы</h2>
      <p className="muted">Заявки связаны с ledger WITHDRAWAL. MANUAL не переводит деньги и не выставляет PAID; отклонение атомарно возвращает списание.</p>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Пользователь</th>
            <th>Сумма</th>
            <th>Статус</th>
            <th>Пометка</th>
            <th>Когда</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && <EmptyRows colSpan={6} label="Запросов на вывод нет." />}
          {items.map((w) => (
            <tr key={w.id}>
              <td>{w.onixId || '—'}</td>
              <td>{w.amountRub ?? money(w.amountCents)}</td>
              <td>{ruStatus(w.status)}</td>
              <td>
                {w.riskReasons?.join(', ') || w.reviewReason || '—'}
                {w.refundLedgerEntryId ? ` · возврат #${w.refundLedgerEntryId}` : ''}
              </td>
              <td>{new Date(w.createdAt).toLocaleString('ru-RU')}</td>
              <td>
                {['REQUESTED', 'RISK_REVIEW', 'MANUAL_REVIEW'].includes(w.status) && (
                  <button disabled={busyId === w.id} onClick={() => void decide(w, 'approve')}>
                    Одобрить
                  </button>
                )}
                {['REQUESTED', 'RISK_REVIEW', 'APPROVED', 'FAILED', 'MANUAL_REVIEW'].includes(w.status) && (
                  <button disabled={busyId === w.id} onClick={() => void decide(w, 'reject')}>
                    Отклонить и вернуть
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
