import { useCallback, useEffect, useState } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, type SupportQueueItem, type UserReportItem } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Button, Card, Confirm, Input, Skeleton, StateView } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
import type { Core } from './types';

export function SupportQueue({
  core, setToast, openDealChat, openDirectChat, openUserProfile,
}: {
  core: Core;
  setToast: (text: string) => void;
  openDealChat: (chatId: string) => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  openUserProfile: (onixId: string) => void;
}) {
  const [tab, setTab] = useState<'orders' | 'people'>('orders');
  const [items, setItems] = useState<SupportQueueItem[]>([]);
  const [reports, setReports] = useState<UserReportItem[]>([]);
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [confirm, setConfirm] = useState<{ orderId: string; action: 'refund' | 'complete' } | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyBusyId, setReplyBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setState('loading');
    try {
      const [queue, people] = await Promise.all([
        api.get<SupportQueueItem[]>(API_PATHS.supportQueue),
        api.get<UserReportItem[]>(API_PATHS.supportReports),
      ]);
      setItems(queue);
      setReports(people);
      setState('success');
    } catch {
      setItems([]);
      setReports([]);
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
    setToast(confirm.action === 'refund' ? 'Возврат выполнен. Решение отправлено в чат.' : 'Сделка подтверждена. Решение отправлено в чат.');
    await reload();
  };

  const sendAiReply = async (reportId: string) => {
    const text = (replyDrafts[reportId] ?? '').trim();
    if (!text) {
      setToast('Введите ответ.');
      return;
    }
    setReplyBusyId(reportId);
    try {
      await api.post(API_PATHS.supportReportReply(reportId), { text });
      setReports((prev) => prev.filter((item) => item.id !== reportId));
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[reportId];
        return next;
      });
      setToast('Ответ отправлен в ONIX AI пользователю.');
    } catch {
      setToast('Не удалось отправить ответ.');
    } finally {
      setReplyBusyId(null);
    }
  };

  if (state === 'loading' && items.length === 0 && reports.length === 0) {
    return <Card><Skeleton lines={5} /></Card>;
  }
  if (state === 'error') {
    return <StateView title="Очередь недоступна" text="Не удалось загрузить обращения." action={<Button onClick={() => void reload()}>Обновить</Button>} />;
  }

  return <div className="stack compact">
    <div className="segmented">
      <button type="button" className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>ЗАКАЗЫ</button>
      <button type="button" className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>ЖАЛОБЫ</button>
    </div>

    {tab === 'orders' && (items.length === 0
      ? <StateView title="Нет заказов" text="Жалобы на сделки и споры появятся здесь." />
      : items.map((item) => (
        <Card key={`${item.orderId}-${item.ticketId ?? 'd'}`}>
          <div className="seller-row">
            <div>
              <small>{item.kind === 'DISPUTE' ? 'Спор' : 'Поддержка'} · Заказ #{item.orderId} · {item.status}</small>
              <b>{item.productTitle}</b>
              <p className="muted">
                {publicAt(item.buyer.username)} ↔ {publicAt(item.seller.username)}
                {item.reason ? ` · ${item.reason}` : ''}
              </p>
            </div>
            <strong>{money(item.totalAmountCents)}</strong>
          </div>
          <div className="card-actions">
            <Button variant="secondary" disabled={!item.chatId} onClick={() => { if (item.chatId) openDealChat(item.chatId); }}>
              Открыть чат
            </Button>
            <Button variant="danger" busy={core.actionBusy === `refund-${item.orderId}`} onClick={() => setConfirm({ orderId: item.orderId, action: 'refund' })}>
              Возврат покупателю
            </Button>
            <Button busy={core.actionBusy === `complete-${item.orderId}`} onClick={() => setConfirm({ orderId: item.orderId, action: 'complete' })}>
              Подтвердить продавцу
            </Button>
          </div>
        </Card>
      )))}

    {tab === 'people' && (reports.length === 0
      ? <StateView title="Жалоб нет" text="Жалобы на пользователей и обращения из ONIX AI появятся здесь." />
      : reports.map((r) => {
        const isAi = r.kind === 'AI_SUPPORT';
        return (
          <Card key={r.id}>
            <div className="seller-row">
              <div className="user-summary">
                <UserAvatar
                  avatarUrl={isAi ? r.reporter.avatarUrl : r.target.avatarUrl}
                  name={isAi ? r.reporter.username : r.target.username}
                />
                <div>
                  <b>{isAi ? 'Обращение из ONIX AI' : `На ${publicAt(r.target.username)}`}</b>
                  <p className="muted">
                    {isAi
                      ? `${formatOnixId(r.reporter.onixId)} · ${publicAt(r.reporter.username)}`
                      : `${formatOnixId(r.target.onixId)} · от ${publicAt(r.reporter.username)}`}
                  </p>
                  <p className="muted">{isAi ? r.comment : `${r.reason}: ${r.comment}`}</p>
                </div>
              </div>
            </div>
            {isAi && (
              <div className="stack compact" style={{ marginTop: 10 }}>
                <Input
                  value={replyDrafts[r.id] ?? ''}
                  onChange={(event) => setReplyDrafts((prev) => ({ ...prev, [r.id]: event.target.value }))}
                  maxLength={2000}
                  placeholder="Ответ пользователю в ONIX AI…"
                  aria-label="Ответ в ONIX AI"
                />
                <div className="card-actions">
                  <Button busy={replyBusyId === r.id} onClick={() => void sendAiReply(r.id)}>
                    Ответить в AI
                  </Button>
                </div>
              </div>
            )}
            <div className="card-actions">
              {!isAi && (
                <>
                  <Button variant="secondary" onClick={() => openUserProfile(r.target.onixId)}>Профиль</Button>
                  <Button variant="secondary" busy={core.actionBusy === `chat-${r.target.onixId}`} onClick={() => void openDirectChat(r.target.onixId)}>
                    Чат / диалог
                  </Button>
                </>
              )}
              <Button variant="secondary" busy={core.actionBusy === `chat-${r.reporter.onixId}`} onClick={() => void openDirectChat(r.reporter.onixId)}>
                {isAi ? 'Профиль / чат' : 'Чат с жалобщиком'}
              </Button>
              <Button variant="danger" busy={core.actionBusy === `report-close-${r.id}`} onClick={async () => {
                try {
                  await api.post(API_PATHS.supportReportClose(r.id), {});
                  setReports((prev) => prev.filter((item) => item.id !== r.id));
                  setToast('Жалоба закрыта.');
                } catch {
                  setToast('Не удалось закрыть жалобу.');
                }
              }}>Закрыть</Button>
            </div>
          </Card>
        );
      }))}

    <Confirm
      open={Boolean(confirm)}
      dangerous={confirm?.action === 'refund'}
      title={confirm?.action === 'refund' ? 'Вернуть средства покупателю?' : 'Подтвердить сделку продавцу?'}
      text={confirm?.action === 'refund'
        ? 'В чат уйдёт решение: деньги вернутся покупателю. Комиссия не удерживается с возврата.'
        : 'В чат уйдёт решение: продавцу зачислят выплату минус 5% комиссии.'}
      busy={Boolean(confirm && (core.actionBusy === `refund-${confirm.orderId}` || core.actionBusy === `complete-${confirm.orderId}`))}
      onCancel={() => setConfirm(null)}
      onConfirm={() => void runAction()}
    />
  </div>;
}

export default SupportQueue;
