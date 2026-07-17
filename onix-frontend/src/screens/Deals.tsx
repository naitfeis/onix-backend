import { useEffect, useRef, useState } from 'react';
import { money } from '../api/client';
import { sellerIsPresent, type Deal, type OrderListQuery } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Badge, Button, Card, Confirm, Field, Modal, Select, Skeleton, StateView, Textarea } from '../design-system';
import type { Core, Screen } from './types';
import { DEAL_FILTERS, StaffBadge, dealLabels, dealProgress } from './shared';

export function ReviewForm({ deal, core, onClose, setToast }: { deal: Deal | null; core: Core; onClose: () => void; setToast: (text: string) => void }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  return <Modal open={Boolean(deal)} title="Отзыв о сделке" onClose={onClose}><form className="form" onSubmit={async event => { event.preventDefault(); if (deal && text.trim() && await core.submitReview(deal.id, rating, text)) { setText(''); setToast('Спасибо, отзыв опубликован.'); onClose(); } }}>
    <Field label="Оценка"><Select value={rating} onChange={event => setRating(Number(event.target.value))}>{[5,4,3,2,1].map(value => <option key={value} value={value}>{'★'.repeat(value)}</option>)}</Select></Field>
    <Field label="Комментарий"><Textarea required minLength={5} maxLength={500} value={text} onChange={event => setText(event.target.value)} /></Field>
    <div className="modal__actions"><Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit" busy={core.actionBusy === 'review'}>Опубликовать</Button></div>
  </form></Modal>;
}

export function Deals({
  core, switchTo, setToast, focusDealId, onFocusDealHandled, openDealChat,
}: {
  core: Core;
  switchTo: (screen: Screen) => void;
  setToast: (text: string) => void;
  focusDealId: string | null;
  onFocusDealHandled: () => void;
  openDealChat: (chatId: string) => void;
}) {
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [dealFilter, setDealFilter] = useState('all');
  const [confirm, setConfirm] = useState<{ deal: Deal; action: 'deliver' | 'complete' | 'dispute' } | null>(null);
  const [reviewDeal, setReviewDeal] = useState<Deal | null>(null);
  const [refundDeal, setRefundDeal] = useState<Deal | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [highlightedDealId, setHighlightedDealId] = useState<string | null>(null);
  const activeFilter = DEAL_FILTERS.find(item => item.id === dealFilter) ?? DEAL_FILTERS[0];
  const listQuery: OrderListQuery = {
    ...(activeFilter.status ? { status: activeFilter.status } : {}),
  };
  const skipBootstrappedAll = useRef(true);
  useEffect(() => {
    if (!core.profile) return;
    // Bootstrap already loaded GET /orders — skip duplicate on first Deals mount with filter=all.
    if (dealFilter === 'all' && skipBootstrappedAll.current) {
      skipBootstrappedAll.current = false;
      return;
    }
    skipBootstrappedAll.current = false;
    void core.listDeals(listQuery);
  }, [core.listDeals, core.profile, dealFilter]);
  useEffect(() => {
    if (!focusDealId) return;
    setDealFilter('all');
    setHighlightedDealId(focusDealId);
    const deal = core.deals.find((item) => item.id === focusDealId);
    if (deal) setRole(deal.role);
    onFocusDealHandled();
  }, [core.deals, focusDealId, onFocusDealHandled]);
  const deals = core.deals.filter(deal => deal.role === role);
  const isSupport = Boolean(core.profile?.roles.includes('SUPPORT') || core.profile?.roles.includes('ADMIN'));
  return <div className="stack">
    <div className="chips" role="list" aria-label="Фильтры сделок">{DEAL_FILTERS.map(item =>
      <button role="listitem" className={dealFilter === item.id ? 'active' : ''} key={item.id} onClick={() => setDealFilter(item.id)}>{item.label.toUpperCase()}</button>)}</div>
    <div className="segmented">{(['buyer', 'seller'] as const).map(item => <button className={role === item ? 'active' : ''} key={item} onClick={() => setRole(item)}>{item === 'buyer' ? 'МОИ ПОКУПКИ' : 'МОИ ПРОДАЖИ'}</button>)}</div>
    {core.states.deals === 'loading' ? <Card><Skeleton lines={5} /></Card> : core.states.deals === 'error' ? <StateView title="Сделки не загрузились" text={core.errors.deals || ''} action={<Button onClick={core.refreshAll}>Повторить</Button>} /> :
      deals.length === 0 ? <StateView title="Здесь пока пусто" text={role === 'buyer' ? 'Купите товар — сделка появится здесь.' : 'Опубликуйте товар и дождитесь покупателя.'} /> :
      deals.map(deal => <Card key={deal.id} className={`deal-card${highlightedDealId === deal.id ? ' deal-card--focus' : ''}`}><div className="seller-row"><div className="user-summary"><UserAvatar avatarUrl={deal.counterparty.avatarUrl} name={deal.counterparty.username} online={sellerIsPresent(deal.counterparty, core.profile)} /><div><h2>{deal.product.title}</h2><p className="muted">@{deal.counterparty.username} <StaffBadge badge={deal.counterparty.badge} /> // {deal.product.category}</p></div></div><strong>{money(deal.totalAmountCents)}</strong></div>
        <div className="deal-status"><span>ФАЗА</span><Badge tone={deal.status === 'COMPLETED' ? 'success' : deal.status === 'DISPUTE' ? 'danger' : 'warning'}>{dealLabels[deal.status]}</Badge></div>
        <ol className="timeline">{['Оплата', 'Hold', 'Передача', 'Выплата'].map((item, index) => <li className={dealProgress(deal.status) >= index ? 'done' : ''} key={item}>{item}</li>)}</ol>
        <div className="card-actions">{role === 'seller' && deal.status === 'PAYMENT_HOLD' && <Button onClick={() => setConfirm({ deal, action: 'deliver' })}>Товар передан</Button>}
          {role === 'buyer' && deal.status === 'DELIVERING' && <Button onClick={() => setConfirm({ deal, action: 'complete' })}>Товар получен</Button>}
          {!deal.complaintOpen && !['COMPLETED', 'CANCELED', 'DISPUTE', 'REFUNDED'].includes(deal.status) && (
            <Button variant="danger" onClick={() => setConfirm({ deal, action: 'dispute' })}>Открыть спор</Button>
          )}
          {role === 'seller' && !['REFUNDED', 'CANCELED'].includes(deal.status) && <Button variant="secondary" onClick={() => { setRefundDeal(deal); setRefundReason(''); }}>Возврат</Button>}
          {!deal.complaintOpen && (
            <Button variant="secondary" busy={core.actionBusy === `support-${deal.id}`} onClick={async () => {
              const ticket = await core.openSupport(deal.id);
              if (!ticket) return;
              setToast('Обращение создано. Поддержка в чате.');
              if (ticket.chatId) openDealChat(ticket.chatId);
              else if (deal.chatId) openDealChat(deal.chatId);
              else switchTo('chat');
            }}>Обратиться в поддержку</Button>
          )}
          {deal.complaintOpen && <span className="muted">Обращение по сделке уже создано</span>}
          {isSupport && !['REFUNDED', 'CANCELED'].includes(deal.status) && <Button variant="danger" busy={core.actionBusy === `refund-${deal.id}`} onClick={async () => {
            if (await core.supportRefund(deal.id, 'Возврат поддержкой')) setToast('Возврат через Escrow выполнен.');
          }}>Refund</Button>}
        </div>
        {deal.status === 'COMPLETED' && deal.canReview && <Button variant="secondary" onClick={() => setReviewDeal(deal)}>Оставить отзыв</Button>}
      </Card>)}
    <Confirm open={Boolean(confirm)} dangerous={confirm?.action === 'dispute'} busy={core.actionBusy?.startsWith('deal-')} title={confirm?.action === 'complete' ? 'Выдать деньги продавцу?' : confirm?.action === 'dispute' ? 'Открыть спор?' : 'Подтвердить передачу?'}
      text={confirm?.action === 'complete' ? 'Это действие необратимо. Подтверждайте только после проверки товара.' : confirm?.action === 'dispute' ? 'Сделка будет остановлена и передана администратору.' : 'Покупатель получит уведомление о передаче.'}
      onCancel={() => setConfirm(null)} onConfirm={async () => { if (confirm && await core.dealAction(confirm.deal, confirm.action)) { setToast('Статус сделки обновлён.'); setConfirm(null); } }} />
    <Modal open={Boolean(refundDeal)} title="Запрос возврата" onClose={() => setRefundDeal(null)}><div className="form">
      <Field label="Причина возврата"><Textarea required maxLength={500} value={refundReason} onChange={event => setRefundReason(event.target.value)} /></Field>
      <div className="modal__actions"><Button variant="secondary" onClick={() => setRefundDeal(null)}>Отмена</Button><Button busy={core.actionBusy === `seller-refund-${refundDeal?.id}`} disabled={!refundReason.trim()} onClick={async () => {
        if (refundDeal && refundReason.trim() && await core.sellerRefund(refundDeal.id, refundReason.trim())) { setRefundDeal(null); setToast('Запрос на возврат отправлен.'); }
      }}>Отправить</Button></div>
    </div></Modal>
    <ReviewForm deal={reviewDeal} core={core} onClose={() => setReviewDeal(null)} setToast={setToast} />
  </div>;
}
export default Deals;
