import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';
import { ruOrderStatus } from '../i18n';

type Order = {
  id: string;
  status: string;
  chatId?: string | null;
  totalAmountCents: string;
  createdAt: string;
  buyer: { onixId: string; telegramId: string; displayName?: string | null };
  seller: { onixId: string; telegramId: string; displayName?: string | null };
  product: { id: string; title: string; status: string };
  disputeReason?: string | null;
};

type Detail = Order & {
  feeCents: string;
  payoutCents: string;
  quantity: number;
  updatedAt: string;
  transitions: Array<{ id: string; from?: string | null; to: string; actorId?: string | null; reason?: string | null; createdAt: string }>;
  supportTickets: Array<{ id: string; status: string; openedById: string; createdAt: string; closedAt?: string | null }>;
  chat?: { id: string; messages: Array<{ id: string; senderId?: string | null; kind: string; text: string; deletedAt?: string | null; createdAt: string }> } | null;
};

const statuses = ['', 'PENDING', 'PAYMENT_HOLD', 'DELIVERING', 'DISPUTE', 'COMPLETED', 'CANCELED', 'REFUNDED'];

function money(cents: string) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return cents;
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n / 100);
}

export function OrdersScreen({
  onOpenChat,
  onOpenLot,
  onOpenUser,
}: {
  onOpenChat: (chatId: string) => void;
  onOpenLot?: (productId: string) => void;
  onOpenUser?: (onixId: string) => void;
}) {
  const [status, setStatus] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi<{ orders: Order[] }>(`/api/admin/orders?limit=100${status ? `&status=${status}` : ''}`);
      setOrders(result.orders);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : 'Не удалось загрузить сделки');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function open(id: string) {
    setError(null);
    try {
      setDetail(await adminApi<Detail>(`/api/admin/orders/${encodeURIComponent(id)}`));
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : 'Не удалось открыть сделку');
    }
  }

  async function act(path: string) {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi(path, { method: 'POST', body: JSON.stringify({ reason: reason.trim() || undefined }) });
      await open(detail.id);
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : 'Не удалось выполнить действие');
    } finally {
      setBusy(false);
    }
  }

  const chatId = detail?.chat?.id || detail?.chatId;

  return (
    <div className="panel">
      <h2>Сделки</h2>
      <div className="row">
        <label>Статус
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {statuses.map((s) => (
              <option key={s} value={s}>{s ? ruOrderStatus(s) : 'Все'}</option>
            ))}
          </select>
        </label>
        <button className="primary" type="button" disabled={busy} onClick={() => void load()}>
          {busy ? '…' : 'Обновить'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <table>
        <thead><tr><th>ID</th><th>Статус</th><th>Покупатель</th><th>Продавец</th><th>Сумма</th><th>Создана</th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td><button className="link-button" type="button" onClick={() => void open(o.id)}>#{o.id}</button></td>
              <td>{ruOrderStatus(o.status)}</td>
              <td>{o.buyer.onixId}</td>
              <td>{o.seller.onixId}</td>
              <td>{money(o.totalAmountCents)}</td>
              <td>{new Date(o.createdAt).toLocaleString('ru-RU')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail && (
        <div className="detail">
          <h3>Сделка #{detail.id}</h3>
          <p>
            <button className="link-button" type="button" onClick={() => onOpenLot?.(detail.product.id)}>{detail.product.title}</button>
            {' · '}
            {ruOrderStatus(detail.status)} · {detail.buyer.onixId} → {detail.seller.onixId}
            {' · '}
            {money(detail.totalAmountCents)}
          </p>
          {(() => {
            const refunded = [...detail.transitions].reverse().find((t) => t.to === 'REFUNDED');
            const completed = [...detail.transitions].reverse().find((t) => t.to === 'COMPLETED');
            return (
              <>
                {refunded && (
                  <p className="muted">
                    {refunded.reason?.startsWith('Продавец:')
                      ? 'Возврат сделал продавец'
                      : 'Возврат с вмешательством администратора'}
                  </p>
                )}
                {completed && (
                  <p className="muted">
                    {completed.reason?.includes('поддержка') || completed.reason?.startsWith('Администратор:')
                      ? 'Выплату подтвердил администратор'
                      : 'Выплату подтвердил покупатель'}
                  </p>
                )}
              </>
            );
          })()}
          {detail.disputeReason && <p className="flag">Спор: {detail.disputeReason}</p>}
          <label>Комментарий к действию
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="для журнала и сторон сделки" />
          </label>
          <div className="row">
            {chatId && <button className="primary" type="button" onClick={() => onOpenChat(chatId)}>Открыть чат сделки</button>}
            {onOpenLot && (
              <button className="ghost" type="button" onClick={() => onOpenLot(detail.product.id)}>Открыть лот</button>
            )}
            {onOpenUser && (
              <>
                <button className="ghost" type="button" onClick={() => onOpenUser(detail.buyer.onixId)}>Покупатель</button>
                <button className="ghost" type="button" onClick={() => onOpenUser(detail.seller.onixId)}>Продавец</button>
              </>
            )}
            {['PAYMENT_HOLD', 'DELIVERING', 'DISPUTE', 'COMPLETED'].includes(detail.status) && (
              <button className="danger" type="button" disabled={busy} onClick={() => void act(`/api/admin/orders/${detail.id}/refund`)}>
                Возврат покупателю (админ)
              </button>
            )}
            {['PAYMENT_HOLD', 'DELIVERING'].includes(detail.status) && (
              <button className="primary" type="button" disabled={busy} onClick={() => void act(`/api/admin/orders/${detail.id}/complete`)}>
                Подтверждение продавцу (выплата)
              </button>
            )}
          </div>
          <h3>Переходы</h3>
          <table>
            <thead><tr><th>Из</th><th>В</th><th>Кто</th><th>Причина</th><th>Когда</th></tr></thead>
            <tbody>
              {detail.transitions.map((t) => (
                <tr key={t.id}>
                  <td>{t.from ? ruOrderStatus(t.from) : 'создана'}</td>
                  <td>{ruOrderStatus(t.to)}</td>
                  <td>{t.actorId || 'система'}</td>
                  <td>{t.reason || '—'}</td>
                  <td>{new Date(t.createdAt).toLocaleString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Сообщения</h3>
          {detail.chat?.messages.map((m) => (
            <div className="message" key={m.id}>
              <span className="muted">{m.senderId || 'system'} · {new Date(m.createdAt).toLocaleString('ru-RU')}</span>
              <div>{m.deletedAt ? <s>{m.text}</s> : m.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
