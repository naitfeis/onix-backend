import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, SUBCATEGORY_LABELS, formatLastSeen, sellerIsPresent, type Deal, type OrderListQuery, type PublicProfile } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { IconChat, IconCheck, IconFail, IconProfile, IconRefund } from '../components/NavIcons';
import { Button, Card, Confirm, Field, Modal, Select, Skeleton, StateView, Textarea } from '../design-system';
import { publicAt } from '../utils/publicAt';
import type { Core, Screen } from './types';
import { DEAL_FILTERS, DEAL_PHASES, PublicProfileModal, dealProgress, dealStatusView } from './shared';
import { WARRANTY_DEFAULT_HOURS, formatDealCountdown } from '../utils/warranty';
import { categoryLabel as displayCategory } from '../i18n';

function formatPhaseStamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

function StatusIcon({ icon }: { icon: ReturnType<typeof dealStatusView>['icon'] }) {
  if (icon === 'refund') return <IconRefund size={18} />;
  if (icon === 'fail' || icon === 'dispute') return <IconFail size={18} />;
  return <IconCheck size={18} />;
}

export function ReviewForm({ deal, core, onClose, setToast }: { deal: Deal | null; core: Core; onClose: () => void; setToast: (text: string) => void }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  return <Modal open={Boolean(deal)} title="Отзыв о сделке" onClose={onClose}><form className="form" onSubmit={async event => { event.preventDefault(); if (deal && text.trim() && await core.submitReview(deal.id, rating, text)) { setText(''); setToast('Спасибо, отзыв опубликован.'); onClose(); } }}>
    <Field label="Оценка"><Select value={rating} onChange={event => setRating(Number(event.target.value))}>{[5,4,3,2,1].map(value => <option key={value} value={value}>{'★'.repeat(value)}</option>)}</Select></Field>
    <Field label="Комментарий"><Textarea required minLength={5} maxLength={500} value={text} onChange={event => setText(event.target.value)} /></Field>
    <div className="modal__actions"><Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit" busy={core.actionBusy === 'review'}>Опубликовать</Button></div>
  </form></Modal>;
}

type DealCardProps = {
  deal: Deal;
  role: 'buyer' | 'seller';
  online: boolean;
  lastSeenLabel: string;
  highlighted: boolean;
  timersActive: boolean;
  supportBusy: boolean;
  onOpenPeer: (deal: Deal) => void;
  onGoToChat: (deal: Deal) => void;
  onDeliver: (deal: Deal) => void;
  onComplete: (deal: Deal) => void;
  onRefund: (deal: Deal) => void;
  onSupport: (deal: Deal) => void;
  onReview: (deal: Deal) => void;
};

const DealOrderCard = memo(function DealOrderCard({
  deal, role, online, lastSeenLabel, highlighted, timersActive, supportBusy,
  onOpenPeer, onGoToChat, onDeliver, onComplete, onRefund, onSupport, onReview,
}: DealCardProps) {
  const categoryName = displayCategory(deal.product.category);
  const subLabel = deal.product.subcategory
    ? (SUBCATEGORY_LABELS[deal.product.subcategory] ?? deal.product.subcategory)
    : null;
  const status = dealStatusView(deal.status);
  const progress = dealProgress(deal.status);
  const stamp = formatPhaseStamp(deal.createdAt);
  const failed = deal.status === 'CANCELED' || deal.status === 'REFUNDED';
  const sellerCanRefund = role === 'seller' && ['PAYMENT_HOLD', 'DELIVERING', 'DISPUTE'].includes(deal.status);
  const sellerCanDeliver = role === 'seller' && deal.status === 'PAYMENT_HOLD';
  const buyerCanComplete = role === 'buyer' && deal.status === 'DELIVERING';
  const canSupport = !deal.complaintOpen;

  return (
    <Card className={`deal-card deal-card--order${highlighted ? ' deal-card--focus' : ''} deal-card--${status.tone}`}>
      <div className="deal-order">
        <div className="deal-order__left">
          <div className="deal-order__identity">
            <UserAvatar
              userId={deal.counterparty.id}
              avatarUrl={deal.counterparty.avatarUrl}
              name={deal.counterparty.username}
              size="medium"
              online={online}
              onClick={() => { onOpenPeer(deal); }}
            />
            <div className="deal-order__copy">
              <h2 title={deal.product.title}>{deal.product.title}</h2>
              <p className="deal-order__peer">
                <button type="button" className="linkish" onClick={() => { onOpenPeer(deal); }}>
                  {publicAt(deal.counterparty.username)}
                </button>
                {' · '}
                {online ? 'Online' : lastSeenLabel}
              </p>
              <div className="deal-lot-tags">
                <span className="lot-sheet__badge">{categoryName}</span>
                {subLabel ? <span className="lot-sheet__badge">{subLabel}</span> : null}
                {deal.product.autoDeliver ? <span className="lot-sheet__badge lot-sheet__badge--auto">⚡ Автовыдача</span> : null}
              </div>
            </div>
          </div>
          <div className="deal-order__peer-actions">
            <button type="button" className="deal-chip" onClick={() => { onGoToChat(deal); }}>
              <IconChat size={15} /> Написать
            </button>
            <button type="button" className="deal-chip" onClick={() => { onOpenPeer(deal); }}>
              <IconProfile size={15} /> Профиль
            </button>
          </div>
          <div className="deal-order__actions">
            {sellerCanDeliver && (
              <button type="button" className="deal-chip" onClick={() => onDeliver(deal)}>
                Подтвердить передачу
              </button>
            )}
            {buyerCanComplete && (
              <button type="button" className="deal-chip" onClick={() => onComplete(deal)}>
                Подтвердить получение
              </button>
            )}
            {sellerCanRefund && (
              <button type="button" className="deal-chip" onClick={() => onRefund(deal)}>
                Возврат покупателю
              </button>
            )}
            {canSupport && (
              <button
                type="button"
                className="deal-chip"
                disabled={supportBusy}
                onClick={() => { onSupport(deal); }}
              >
                Обратиться в поддержку
              </button>
            )}
            {deal.status === 'COMPLETED' && deal.canReview && (
              <button type="button" className="deal-chip" onClick={() => onReview(deal)}>Оставить отзыв</button>
            )}
          </div>
        </div>

        <div className="deal-order__mid">
          <div className={`deal-status-banner deal-status-banner--${status.tone}`}>
            <span className="deal-status-banner__icon" aria-hidden="true"><StatusIcon icon={status.icon} /></span>
            <div className="deal-status-banner__text">
              <b>{status.title}</b>
              <small>{status.detail}</small>
            </div>
            <em className="deal-status-banner__badge">{status.badge}</em>
          </div>
          {deal.refundKind === 'SELLER' && <p className="muted deal-order__note">Возврат оформил продавец.</p>}
          {deal.refundKind === 'ADMIN' && <p className="muted deal-order__note">Возврат с вмешательством администратора.</p>}
          {deal.payoutKind === 'BUYER' && deal.status === 'COMPLETED' && <p className="muted deal-order__note">Выплату подтвердил покупатель.</p>}
          {deal.payoutKind === 'ADMIN' && deal.status === 'COMPLETED' && <p className="muted deal-order__note">Выплату подтвердил администратор.</p>}
          <ol className={`timeline timeline--order${failed ? ' timeline--failed' : ''}`}>
            {DEAL_PHASES.map((item, index) => {
              const done = progress >= index;
              return (
                <li className={done ? 'done' : ''} key={item} title={item}>
                  <i className="timeline__dot" aria-hidden="true">{done ? <IconCheck size={10} /> : null}</i>
                  <span>{item}</span>
                  {item === 'Выплата'
                    ? (timersActive ? <DealPayoutTimer deal={deal} /> : <em className="timeline__timer">{deal.warrantyHours ?? deal.product.warrantyHours ?? WARRANTY_DEFAULT_HOURS} ч</em>)
                    : (done && stamp ? <em className="timeline__timer">{stamp}</em> : null)}
                </li>
              );
            })}
          </ol>
          {deal.dispute && (
            <div className={`dispute-card${deal.dispute.status === 'RESOLVED' ? ' dispute-card--resolved' : ''}`} role="status">
              <h3>Ваш спор</h3>
              <p className="dispute-card__no">№{deal.dispute.orderId}</p>
              <dl className="dispute-card__grid">
                <div><dt>Статус</dt><dd>{deal.dispute.statusLabel}</dd></div>
                <div><dt>Мой профиль</dt><dd>{deal.dispute.supportLabel}</dd></div>
                <div>
                  <dt>Очередь</dt>
                  <dd>
                    {deal.dispute.status === 'REVIEWING' && deal.dispute.queuePosition != null
                      ? `${deal.dispute.queuePosition} из ${Math.max(deal.dispute.queueTotal, 1)}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Среднее</dt>
                  <dd>{deal.dispute.avgWaitMinutes != null ? `~${deal.dispute.avgWaitMinutes} мин` : '—'}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        <div className="deal-order__right">
          <div className="deal-order__sum">
            <small>Сумма заказа</small>
            <strong>{money(deal.totalAmountCents)}</strong>
            <span className={`deal-order__sum-status deal-order__sum-status--${status.tone}`}>
              {status.tone === 'success' ? <IconCheck size={12} /> : status.tone === 'danger' ? <IconRefund size={12} /> : null}
              {status.badge.charAt(0) + status.badge.slice(1).toLowerCase()}
            </span>
          </div>
        </div>
      </div>

      {deal.complaintOpen && (
        <button type="button" className="deal-order__footer" onClick={() => { onGoToChat(deal); }}>
          <IconChat size={16} />
          <span>Обращение по сделке уже создано</span>
        </button>
      )}
    </Card>
  );
});

export function Deals({
  core, switchTo, setToast, focusDealId, onFocusDealHandled, openDealChat, openDirectChat, active = true,
}: {
  core: Core;
  switchTo: (screen: Screen) => void;
  setToast: (text: string) => void;
  focusDealId: string | null;
  onFocusDealHandled: () => void;
  openDealChat: (chatId: string) => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  active?: boolean;
}) {
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [dealFilter, setDealFilter] = useState('all');
  const [confirm, setConfirm] = useState<{ deal: Deal; action: 'deliver' | 'complete' } | null>(null);
  const [reviewDeal, setReviewDeal] = useState<Deal | null>(null);
  const [refundDeal, setRefundDeal] = useState<Deal | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [highlightedDealId, setHighlightedDealId] = useState<string | null>(null);
  const [peerProfile, setPeerProfile] = useState<PublicProfile | null>(null);
  const activeFilter = DEAL_FILTERS.find(item => item.id === dealFilter) ?? DEAL_FILTERS[0];
  const listQuery: OrderListQuery = {
    ...(activeFilter.status ? { status: activeFilter.status } : {}),
  };
  const skipBootstrappedAll = useRef(true);
  useEffect(() => {
    if (!core.profile) return;
    if (dealFilter === 'all' && skipBootstrappedAll.current) {
      skipBootstrappedAll.current = false;
      return;
    }
    skipBootstrappedAll.current = false;
    const controller = new AbortController();
    void core.listDeals(listQuery, controller.signal);
    return () => controller.abort();
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

  const openPeer = useCallback((deal: Deal) => {
    void (async () => {
      try {
        setPeerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(deal.counterparty.onixId)));
      } catch (error) {
        setToast(error instanceof Error ? error.message : 'Не удалось открыть профиль.');
      }
    })();
  }, [setToast]);

  const goToChat = useCallback((deal: Deal) => {
    void (async () => {
      if (deal.chatId) {
        openDealChat(deal.chatId);
        return;
      }
      const ok = await openDirectChat(deal.counterparty.onixId);
      if (!ok) setToast('Не удалось открыть чат.');
    })();
  }, [openDealChat, openDirectChat, setToast]);

  const openSupport = useCallback((deal: Deal) => {
    void (async () => {
      const ticket = await core.openSupport(deal.id);
      if (!ticket) return;
      setToast('Обращение создано. Поддержка ответит в чате.');
      if (ticket.chatId) openDealChat(ticket.chatId);
      else if (deal.chatId) openDealChat(deal.chatId);
      else switchTo('chat');
    })();
  }, [core, openDealChat, setToast, switchTo]);

  const onDeliver = useCallback((d: Deal) => setConfirm({ deal: d, action: 'deliver' }), []);
  const onComplete = useCallback((d: Deal) => setConfirm({ deal: d, action: 'complete' }), []);
  const onRefund = useCallback((d: Deal) => { setRefundDeal(d); setRefundReason(''); }, []);
  const onReview = useCallback((d: Deal) => setReviewDeal(d), []);

  // Sleep while off-screen so presence ticks don't re-render heavy order cards.
  if (!active) {
    return <div className="stack" aria-hidden="true" />;
  }

  return <div className="stack">
    <div className="chips" role="list" aria-label="Фильтры сделок">{DEAL_FILTERS.map(item =>
      <button role="listitem" className={dealFilter === item.id ? 'active' : ''} key={item.id} onClick={() => setDealFilter(item.id)}>{item.label.toUpperCase()}</button>)}</div>
    <div className="chips deal-role-tabs" role="tablist" aria-label="Роль в сделках">{(['buyer', 'seller'] as const).map(item => (
      <button
        type="button"
        role="tab"
        aria-selected={role === item}
        className={role === item ? 'active' : ''}
        key={item}
        onClick={() => setRole(item)}
      >{item === 'buyer' ? 'МОИ ПОКУПКИ' : 'МОИ ПРОДАЖИ'}</button>
    ))}</div>
    {core.states.deals === 'loading' ? <Card><Skeleton lines={5} /></Card> : core.states.deals === 'error' ? <StateView title="Сделки не загрузились" text={core.errors.deals || ''} action={<Button onClick={core.refreshAll}>Повторить</Button>} /> :
      deals.length === 0 ? <StateView title="Здесь пока пусто" text={role === 'buyer' ? 'Купите товар — сделка появится здесь.' : 'Опубликуйте товар и дождитесь покупателя.'} /> :
      deals.map(deal => {
        const presence = core.presenceOf(deal.counterparty.onixId);
        const online = sellerIsPresent(deal.counterparty, core.profile, presence);
        return (
          <DealOrderCard
            key={deal.id}
            deal={deal}
            role={role}
            online={online}
            lastSeenLabel={formatLastSeen(presence?.lastOnline ?? deal.counterparty.lastOnline)}
            highlighted={highlightedDealId === deal.id}
            timersActive={active}
            supportBusy={core.actionBusy === `support-${deal.id}`}
            onOpenPeer={openPeer}
            onGoToChat={goToChat}
            onDeliver={onDeliver}
            onComplete={onComplete}
            onRefund={onRefund}
            onSupport={openSupport}
            onReview={onReview}
          />
        );
      })}
    <Confirm
      open={Boolean(confirm)}
      busy={core.actionBusy?.startsWith('deal-')}
      title={confirm?.action === 'complete' ? 'Подтвердить получение и выплату продавцу?' : 'Подтвердить передачу товара?'}
      text={confirm?.action === 'complete'
        ? 'Это действие необратимо. Подтверждайте только после проверки товара.'
        : 'Покупатель получит уведомление о передаче.'}
      onCancel={() => setConfirm(null)}
      onConfirm={async () => {
        if (confirm && await core.dealAction(confirm.deal, confirm.action)) {
          setToast('Статус сделки обновлён.');
          setConfirm(null);
        }
      }}
    />
    <Modal open={Boolean(refundDeal)} title="Запрос возврата" onClose={() => setRefundDeal(null)}><div className="form">
      <Field label="Причина возврата"><Textarea required maxLength={500} value={refundReason} onChange={event => setRefundReason(event.target.value)} /></Field>
      <div className="modal__actions"><Button variant="secondary" onClick={() => setRefundDeal(null)}>Отмена</Button><Button busy={core.actionBusy === `seller-refund-${refundDeal?.id}`} disabled={!refundReason.trim()} onClick={async () => {
        if (refundDeal && refundReason.trim() && await core.sellerRefund(refundDeal.id, refundReason.trim())) { setRefundDeal(null); setToast('Запрос на возврат отправлен.'); }
      }}>Отправить</Button></div>
    </div></Modal>
    <ReviewForm deal={reviewDeal} core={core} onClose={() => setReviewDeal(null)} setToast={setToast} />
    <PublicProfileModal
      profile={peerProfile}
      onClose={() => setPeerProfile(null)}
      core={core}
      setToast={setToast}
      onWrite={async (onixId) => {
        setPeerProfile(null);
        await openDirectChat(onixId);
      }}
    />
  </div>;
}

function DealPayoutTimer({ deal }: { deal: Deal }) {
  const hours = deal.warrantyHours ?? deal.product.warrantyHours ?? WARRANTY_DEFAULT_HOURS;
  const needsTick = Boolean(deal.warrantyEndsAt)
    && deal.status !== 'COMPLETED'
    && deal.status !== 'CANCELED'
    && deal.status !== 'REFUNDED';
  const labelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!needsTick || !deal.warrantyEndsAt) return;
    const el = labelRef.current;
    if (!el) return;
    const tick = () => {
      const running = formatDealCountdown(deal.warrantyEndsAt, Date.now());
      el.textContent = running ?? `${hours} ч`;
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [needsTick, deal.warrantyEndsAt, deal.id, hours]);
  if (deal.status === 'COMPLETED') {
    return <em className="timeline__timer">выплачено</em>;
  }
  const initial = formatDealCountdown(deal.warrantyEndsAt, Date.now());
  return (
    <em
      ref={labelRef}
      className="timeline__timer"
      aria-label={`Гарантия ${hours} ч`}
    >{initial ?? `${hours} ч`}</em>
  );
}

export default Deals;
