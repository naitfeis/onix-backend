import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';
import { humanPayload, ruPriority, ruRiskType, ruTicketCategory, ruTicketStatus } from '../i18n';

type TicketListItem = {
  id: string;
  publicId: string;
  status: string;
  category: string;
  priority: string;
  subject: string | null;
  createdAt: string;
  chatId: string | null;
  reporter: { onixId: string; username?: string | null } | null;
  reportedUser: { onixId: string; username?: string | null; caseId?: string | null; lockLevel?: string | null } | null;
};

type TicketCard = TicketListItem & {
  body?: string | null;
  related: {
    order: { id: string; status: string; listingTitle?: string } | null;
    listingId: string | null;
    chatId: string | null;
    riskEvents: Array<{ id: string; type: string; severity: number; createdAt: string; payload: unknown }>;
    identities: Array<{ provider: string; username?: string | null; linkedAt: string }>;
    sessions: Array<{ id: string; ipAddress?: string | null; country?: string | null; revoked: boolean; lastSeenAt: string }>;
    ledger: Array<{ id: string; type: string; amountCents: string; fundKind?: string; saleKind?: string | null; createdAt: string }>;
  };
  timeline: Array<{ id: string; kind: string; message: string; at: string }>;
};

const STATUS_FILTERS = [
  { id: '', label: 'Все' },
  { id: 'OPEN', label: 'Открытые' },
  { id: 'IN_REVIEW', label: 'В рассмотрении' },
  { id: 'WAITING_USER', label: 'Ожидают пользователя' },
  { id: 'RESOLVED', label: 'Решённые' },
  { id: 'CLOSED', label: 'Закрытые' },
];

const CATEGORY_FILTERS = [
  { id: '', label: 'Все категории' },
  { id: 'FRAUD_REPORT', label: 'Жалоба на мошенничество' },
  { id: 'RISK_ENGINE', label: 'Сигнал риска' },
  { id: 'BAN_EVASION', label: 'Обход блокировки' },
  { id: 'ACCOUNT_SECURITY', label: 'Безопасность аккаунта' },
  { id: 'BAN_APPEAL', label: 'Апелляция бана' },
  { id: 'SELL_BAN_APPEAL', label: 'Апелляция бана продаж' },
  { id: 'WITHDRAWAL_REVIEW', label: 'Проверка вывода' },
  { id: 'CHAT_ABUSE', label: 'Нарушение в чате' },
  { id: 'SPAM', label: 'Спам' },
  { id: 'HARASSMENT', label: 'Оскорбления' },
  { id: 'ORDER_DISPUTE', label: 'Спор по сделке' },
  { id: 'REFUND_REQUEST', label: 'Запрос возврата' },
  { id: 'ITEM_NOT_RECEIVED', label: 'Товар не получен' },
  { id: 'ITEM_NOT_AS_DESCRIBED', label: 'Товар не как в описании' },
  { id: 'ACCOUNT', label: 'Аккаунт' },
  { id: 'PAYMENT', label: 'Оплата' },
  { id: 'BUG', label: 'Ошибка' },
  { id: 'OTHER', label: 'Другое' },
];

export function SupportScreen({ onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<TicketCard | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (category) params.set('category', category);
      const data = await adminApi<{ tickets: TicketListItem[] }>(
        `/api/admin/support/tickets${params.toString() ? `?${params}` : ''}`,
      );
      setTickets(data.tickets);
    } catch (e) { setError(e instanceof AdminApiError ? e.message : 'Не удалось загрузить'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [status, category]);

  async function openCard(id: string) {
    setError(null);
    try {
      const card = await adminApi<TicketCard>(`/api/admin/support/tickets/${encodeURIComponent(id)}`);
      setSelected(card);
    } catch (e) { setError(e instanceof AdminApiError ? e.message : 'Не удалось загрузить'); }
  }

  async function act(path: string, body: object) {
    setError(null);
    try {
      await adminApi(path, { method: 'POST', body: JSON.stringify(body) });
      await load();
      if (selected) await openCard(selected.id);
    } catch (e) { setError(e instanceof AdminApiError ? e.message : 'Не удалось выполнить'); }
  }

  return <div className="panel">
    <h2>Поддержка и безопасность</h2>
    <div className="row">
      {STATUS_FILTERS.map((f) => (
        <button key={f.id || 'all'} type="button" className={status === f.id ? 'primary' : 'ghost'} onClick={() => setStatus(f.id)}>{f.label}</button>
      ))}
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORY_FILTERS.map((f) => (
          <option key={f.id || 'all-cat'} value={f.id}>{f.label}</option>
        ))}
      </select>
      <button className="primary" type="button" disabled={busy} onClick={() => void load()}>Обновить</button>
    </div>
    {error && <p className="error">{error}</p>}
    <table>
      <thead><tr><th>Тикет</th><th>Категория</th><th>Статус</th><th>Приоритет</th><th>Кто / на кого</th></tr></thead>
      <tbody>
        {tickets.map((t) => (
          <tr key={t.id} className="click-row" onClick={() => void openCard(t.id)}>
            <td><strong>{t.publicId}</strong><br /><span className="muted">{t.subject || '—'}</span></td>
            <td>{ruTicketCategory(t.category)}</td>
            <td>{ruTicketStatus(t.status)}</td>
            <td>{ruPriority(t.priority)}</td>
            <td>{t.reporter?.onixId || 'система'} → {t.reportedUser?.onixId || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {selected && <div className="admin-modal" onClick={() => setSelected(null)}>
      <div className="admin-modal__panel" onClick={(e) => e.stopPropagation()}>
        <h2>{selected.publicId}</h2>
        <p>Категория: {ruTicketCategory(selected.category)} · Статус: {ruTicketStatus(selected.status)} · Приоритет: {ruPriority(selected.priority)}</p>
        {selected.reportedUser?.caseId && <p>Дело: {selected.reportedUser.caseId}</p>}
        <p className="muted">{selected.body || '—'}</p>
        <h3>Связанные сущности</h3>
        <ul className="muted">
          <li>Пользователь: {selected.reportedUser?.onixId || selected.reporter?.onixId || '—'}</li>
          <li>Сделка: {selected.related.order?.id || '—'}</li>
          <li>Лот: {selected.related.listingId || selected.related.order?.listingTitle || '—'}</li>
          <li>Чат: {selected.related.chatId || '—'}</li>
          <li>События риска: {selected.related.riskEvents.length}</li>
          <li>Проводки: {selected.related.ledger.length}</li>
          <li>Входы: {selected.related.identities.map((i) => i.provider === 'TELEGRAM' ? 'Telegram' : i.provider === 'GOOGLE' ? 'Google' : i.provider).join(', ') || '—'}</li>
        </ul>
        {selected.related.riskEvents.length > 0 && (
          <div>
            <h3>Доказательства риска</h3>
            {selected.related.riskEvents.map((ev) => (
              <div key={ev.id} className="flag">
                <strong>{ruRiskType(ev.type)}</strong> · {ev.severity}
                <ul>
                  {humanPayload((ev.payload && typeof ev.payload === 'object' ? ev.payload : {}) as Record<string, unknown>).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <h3>История</h3>
        <ol className="timeline">
          {selected.timeline.map((row) => (
            <li key={row.id}><span className="muted">{new Date(row.at).toLocaleString()}</span> {row.message}</li>
          ))}
        </ol>
        <label>Комментарий / причина<textarea value={comment} onChange={(e) => setComment(e.target.value)} /></label>
        <div className="actions-cell">
          {selected.chatId && <button className="ghost" type="button" onClick={() => onOpenChat(selected.chatId!)}>Чат</button>}
          <button className="ghost" type="button" onClick={() => void act(`/api/admin/support/tickets/${selected.id}/status`, { status: 'IN_REVIEW', comment })}>В работу</button>
          <button className="ghost" type="button" onClick={() => void act(`/api/admin/support/tickets/${selected.id}/status`, { status: 'WAITING_USER', comment })}>Ждать пользователя</button>
          <button className="ghost" type="button" onClick={() => void act(`/api/admin/support/tickets/${selected.id}/comment`, { text: comment })}>Комментарий</button>
          <button className="ghost" type="button" onClick={() => void act(`/api/admin/support/tickets/${selected.id}/decision`, { decision: 'KEEP_LOCK', reason: comment })}>Оставить ограничение</button>
          <button className="primary" type="button" onClick={() => void act(`/api/admin/support/tickets/${selected.id}/decision`, { decision: 'UNLOCK', reason: comment })}>Снять ограничение</button>
          <button className="ghost" type="button" onClick={() => void act(`/api/admin/support/tickets/${selected.id}/decision`, { decision: 'REDUCE_RESTRICTIONS', reason: comment })}>Смягчить</button>
          <button className="danger" type="button" onClick={() => void act(`/api/admin/support/tickets/${selected.id}/decision`, { decision: 'PERMANENT_BAN', reason: comment })}>Вечный бан</button>
          <button className="ghost" type="button" onClick={() => setSelected(null)}>Закрыть</button>
        </div>
      </div>
    </div>}
  </div>;
}
