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
};

function money(cents?: string) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return cents ?? '—';
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n / 100);
}

function ruStatus(status: string) {
  return ({
    PENDING: 'ожидает',
    REVIEW: 'проверка',
    APPROVED: 'одобрен',
    REJECTED: 'отклонён',
    PAID: 'выплачен',
    FAILED: 'ошибка',
  } as Record<string, string>)[status] ?? status;
}

export function WithdrawalsScreen() {
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminApi<{ withdrawals: Withdrawal[] }>('/api/admin/withdrawals')
      .then((data) => setItems(data.withdrawals ?? []))
      .catch((err) => setError(err instanceof AdminApiError ? err.message : 'Не удалось загрузить'));
  }, []);

  return (
    <div className="panel">
      <h2>Выводы</h2>
      <p className="muted">Последние заявки на вывод и их проверка.</p>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Пользователь</th>
            <th>Сумма</th>
            <th>Статус</th>
            <th>Пометка</th>
            <th>Когда</th>
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <tr key={w.id}>
              <td>{w.onixId || '—'}</td>
              <td>{w.amountRub ?? money(w.amountCents)}</td>
              <td>{ruStatus(w.status)}</td>
              <td>{w.flag || '—'}</td>
              <td>{new Date(w.createdAt).toLocaleString('ru-RU')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
