import { useCallback, useEffect, useState } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, type SupportQueueItem } from '../api/contracts';
import { Button, Card, Confirm, Skeleton, StateView } from '../design-system';
import type { Core } from './types';

export function SupportQueue({
  core, setToast, openDealChat,
}: {
  core: Core;
  setToast: (text: string) => void;
  openDealChat: (chatId: string) => void;
}) {
  const [items, setItems] = useState<SupportQueueItem[]>([]);
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [confirm, setConfirm] = useState<{ orderId: string; action: 'refund' | 'complete' } | null>(null);

  const reload = useCallback(async () => {
    setState('loading');
    try {
      setItems(await api.get<SupportQueueItem[]>(API_PATHS.supportQueue));
      setState('success');
    } catch {
      setItems([]);
      setState('error');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const runAction = async () => {
    if (!confirm) return;
    const ok = confirm.action === 'refund'
      ? await core.supportRefund(confirm.orderId, 'Решение поддержки: возврат покупателю')
      : await core.supportComplete(confirm.orderId, 'Решение поддержки: подтверждение продавцу');
    if (!ok) return;
    setConfirm(null);
    setToast(confirm.action === 'refund' ? 'Возврат выполнен. Заказ убран из очереди.' : 'Сделка подтверждена продавцу.');
    await reload();
  };

  if (state === 'loading' && items.length === 0) return <Card><Skeleton lines={5} /></Card>;
  if (state === 'error') {
    return <StateView title="Очередь недоступна" text="Не удалось загрузить обращения." action={<Button onClick={() => void reload()}>Обновить</Button>} />;
  }
  if (items.length === 0) {
    return <StateView title="Очередь пуста" text="Споры и обращения в поддержку появятся здесь автоматически." />;
  }

  return <div className="stack compact">
    <Card>
      <h2>// СПОРЫ И ПОДДЕРЖКА</h2>
      <p className="muted">Открытые обращения и заказы в статусе DISPUTE. После возврата или подтверждения продавцу заказ исчезает.</p>
    </Card>
    {items.map((item) => (
      <Card key={`${item.orderId}-${item.ticketId ?? 'd'}`}>
        <div className="seller-row">
          <div>
            <small>{item.kind === 'DISPUTE' ? 'Спор' : 'Поддержка'} · Заказ #{item.orderId} · {item.status}</small>
            <b>{item.productTitle}</b>
            <p className="muted">
              @{item.buyer.username} ↔ @{item.seller.username}
              {item.reason ? ` · ${item.reason}` : ''}
            </p>
          </div>
          <strong>{money(item.totalAmountCents)}</strong>
        </div>
        <div className="card-actions">
          <Button
            variant="secondary"
            disabled={!item.chatId}
            onClick={() => { if (item.chatId) openDealChat(item.chatId); }}
          >Открыть чат</Button>
          <Button
            variant="danger"
            busy={core.actionBusy === `refund-${item.orderId}`}
            onClick={() => setConfirm({ orderId: item.orderId, action: 'refund' })}
          >Возврат покупателю</Button>
          <Button
            busy={core.actionBusy === `complete-${item.orderId}`}
            onClick={() => setConfirm({ orderId: item.orderId, action: 'complete' })}
          >Подтвердить продавцу</Button>
        </div>
      </Card>
    ))}
    <Confirm
      open={Boolean(confirm)}
      dangerous={confirm?.action === 'refund'}
      title={confirm?.action === 'refund' ? 'Вернуть средства покупателю?' : 'Подтвердить сделку продавцу?'}
      text={confirm?.action === 'refund'
        ? 'Escrow вернёт деньги покупателю. Открытые тикеты закроются.'
        : 'Escrow выплатит продавцу. Открытые тикеты закроются.'}
      busy={Boolean(confirm && (core.actionBusy === `refund-${confirm.orderId}` || core.actionBusy === `complete-${confirm.orderId}`))}
      onCancel={() => setConfirm(null)}
      onConfirm={() => void runAction()}
    />
  </div>;
}

export default SupportQueue;
