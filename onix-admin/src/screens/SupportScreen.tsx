import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type QueueItem = {
  ticketId: string | null; orderId: string; chatId?: string | null; kind: string; status: string;
  productTitle: string; totalAmountCents: string; reason?: string | null;
  buyer: { onixId: string }; seller: { onixId: string }; createdAt: string;
};
type Report = {
  id: string; kind: string; reason: string; comment: string; createdAt: string;
  reporter: { onixId: string; username?: string | null };
  target: { onixId: string; username?: string | null };
};

export function SupportScreen({ onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setError(null);
    try {
      const [q, r] = await Promise.all([
        adminApi<{ queue: QueueItem[] }>('/api/admin/support/queue'),
        adminApi<{ reports: Report[] }>('/api/admin/support/reports'),
      ]);
      setQueue(q.queue); setReports(r.reports);
    } catch (e) { setError(e instanceof AdminApiError ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);

  async function act(path: string, body: object) {
    setError(null);
    try { await adminApi(path, { method: 'POST', body: JSON.stringify(body) }); await load(); }
    catch (e) { setError(e instanceof AdminApiError ? e.message : 'Action failed'); }
  }

  return <div className="panel">
    <h2>Тикеты, споры и жалобы</h2>
    <div className="row">
      <label>Комментарий / ответ<textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button className="primary" type="button" disabled={busy} onClick={() => void load()}>Обновить</button>
    </div>
    {error && <p className="error">{error}</p>}
    <h3>Открытые тикеты и споры</h3>
    <table><thead><tr><th>Заказ</th><th>Товар</th><th>Стороны</th><th>Статус</th><th>Причина</th><th>Действия</th></tr></thead>
      <tbody>{queue.map((item) => <tr key={`${item.orderId}:${item.ticketId ?? 'dispute'}`}>
        <td>#{item.orderId}<br /><span className="muted">{item.kind}</span></td>
        <td>{item.productTitle}<br />{Number(item.totalAmountCents) / 100} ₽</td>
        <td>{item.buyer.onixId} → {item.seller.onixId}</td><td>{item.status}</td><td>{item.reason || '—'}</td>
        <td className="actions-cell">
          {item.chatId && <button className="ghost" type="button" onClick={() => onOpenChat(item.chatId!)}>Чат</button>}
          <button className="primary" type="button" onClick={() => void act(`/api/admin/orders/${item.orderId}/complete`, { reason })}>Подтвердить продавцу</button>
          <button className="danger" type="button" onClick={() => void act(`/api/admin/orders/${item.orderId}/refund`, { reason })}>Рефанд</button>
          {item.ticketId && <button className="ghost" type="button" onClick={() => void act(`/api/admin/support/tickets/${item.ticketId}/close`, { reason })}>Закрыть тикет</button>}
        </td>
      </tr>)}</tbody>
    </table>
    <h3>Открытые жалобы</h3>
    <table><thead><tr><th>Тип</th><th>Кто</th><th>На кого</th><th>Текст</th><th>Действия</th></tr></thead>
      <tbody>{reports.map((report) => <tr key={report.id}>
        <td>{report.kind}</td><td>{report.reporter.onixId}</td><td>{report.target.onixId}</td>
        <td>{report.reason}<br /><span className="muted">{report.comment}</span></td>
        <td className="actions-cell">
          {report.kind === 'AI_SUPPORT' && <button className="primary" type="button" disabled={!reason.trim()} onClick={() => void act(`/api/admin/support/reports/${report.id}/reply`, { text: reason })}>Ответить</button>}
          {report.kind === 'REVIEW_APPEAL' && <button className="primary" type="button" onClick={() => void act(`/api/admin/support/reports/${report.id}/uphold-appeal`, {})}>Принять апелляцию</button>}
          <button className="ghost" type="button" onClick={() => void act(`/api/admin/support/reports/${report.id}/close`, { reason })}>Закрыть</button>
        </td>
      </tr>)}</tbody>
    </table>
  </div>;
}
