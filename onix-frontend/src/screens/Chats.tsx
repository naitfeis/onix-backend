import { useEffect, useState } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, formatLastSeen, type PublicProfile } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Button, Card, Input, Skeleton, StateView } from '../design-system';
import type { Core } from './types';
import { MessageText, PublicProfileModal, ReportUserModal, SectionHeader, StaffBadge, dealLabels } from './shared';

export function Chats({
  core, focusChatId, onFocusChatHandled, openDirectChat, openProductCard, openDeal, setToast,
}: {
  core: Core;
  focusChatId: string | null;
  onFocusChatHandled: () => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  openProductCard: (productId: string) => void;
  openDeal: (dealId: string) => void;
  setToast: (text: string) => void;
}) {
  const [threadId, setThreadId] = useState('');
  const [text, setText] = useState('');
  const [peerProfile, setPeerProfile] = useState<PublicProfile | null>(null);
  const [reportOnixId, setReportOnixId] = useState<string | null>(null);
  const thread = core.chats.find(item => item.id === threadId);
  const messages = threadId ? core.messages[threadId] || [] : [];
  const openOnixProfile = async (onixId: string) => {
    if (peerProfile?.onixId === onixId) return;
    try { setPeerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixId))); } catch { /* ignore */ }
  };
  useEffect(() => { if (threadId) void core.loadMessages(threadId); }, [core.loadMessages, threadId]);
  useEffect(() => {
    if (!focusChatId) return;
    setThreadId(focusChatId);
    onFocusChatHandled();
  }, [focusChatId, onFocusChatHandled]);
  if (core.states.chats === 'loading') return <Card><Skeleton lines={6} /></Card>;
  return <div className="chat-layout">
    <div className={`thread-list ${thread ? 'mobile-hidden' : ''}`}><SectionHeader title="ЧАТЫ" subtitle="СООБЩЕНИЯ СДЕЛОК" />
      {core.states.chats === 'error' ? <StateView title="Чаты недоступны" text={core.errors.chats || ''} /> : core.chats.length === 0 ? <StateView title="Нет диалогов" text="Напишите продавцу из карточки товара." /> :
        core.chats.map(chat => <button className="thread" key={chat.id} onClick={() => setThreadId(chat.id)}>
          <span className="thread-peer"><UserAvatar avatarUrl={chat.peerAvatarUrl} name={chat.title} /><span><b>{chat.title} <StaffBadge badge={chat.peerBadge} /></b><small>{chat.subtitle || 'Открыть диалог'}</small></span></span>
          {chat.unreadCount > 0 && <em>{chat.unreadCount}</em>}
        </button>)}</div>
    <div className={`conversation ${!thread ? 'mobile-hidden' : ''}`}>{thread ? <><div className="conversation__head"><Button variant="ghost" className="back" onClick={() => setThreadId('')}>←</Button>
      {thread.peerAvatarUrl !== undefined || thread.title ? <UserAvatar avatarUrl={thread.peerAvatarUrl} name={thread.title} /> : null}
      <div>
      <button type="button" className="linkish" onClick={async () => {
        if (!thread.peerOnixId) return;
        if (peerProfile?.onixId === thread.peerOnixId) return;
        try { setPeerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(thread.peerOnixId))); } catch { /* ignore */ }
      }}><b>{thread.title} <StaffBadge badge={thread.peerBadge} /></b></button>
      <small>{formatLastSeen(thread.peerLastOnline)}</small></div>
      {thread.peerOnixId && core.profile?.onixId !== thread.peerOnixId && (
        <Button variant="ghost" onClick={() => setReportOnixId(thread.peerOnixId!)}>Пожаловаться</Button>
      )}
      </div>
      {thread.orderCard && <div className="order-card-inline" role="region" aria-label="Карточка заказа">
        <div><small>Заказ #{thread.orderCard.id}</small><b>{thread.orderCard.productTitle}</b>
          <span>{money(thread.orderCard.totalAmountCents)} · {dealLabels[thread.orderCard.status]} · Escrow</span></div>
        <Button variant="secondary" onClick={() => openDeal(thread.dealId || thread.orderCard!.id)}>Открыть заказ</Button>
      </div>}
      <div className="messages">{messages.length === 0 ? <StateView title="Начните разговор" text="Сообщения сделки хранятся внутри ONIX." /> : messages.map(message =>
        <div className={`message-row ${message.mine ? 'mine' : ''} ${message.kind === 'SYSTEM' ? 'system' : ''}`} key={message.id}>
          {!message.mine && <UserAvatar avatarUrl={message.kind === 'SYSTEM' ? undefined : message.sender.avatarUrl} name={message.sender.username} />}
          <div className={`message ${message.mine ? 'mine' : ''} ${message.kind === 'SYSTEM' ? 'system' : ''}`}>
            {message.kind !== 'SYSTEM' && <small>@{message.sender.username} <StaffBadge badge={message.sender.badge} /></small>}
            {message.kind === 'SYSTEM' && <small>🛡 ONIX</small>}
            <p><MessageText text={message.text} onOpenOnix={openOnixProfile} /></p>
            {message.kind === 'SYSTEM' && message.text.includes('Заказ создан') && (() => {
              const orderId = message.text.match(/Заказ #(\d+)/)?.[1]
                || thread.dealId
                || thread.orderCard?.id;
              if (!orderId) return null;
              return <Button variant="secondary" onClick={() => openDeal(orderId)}>Открыть заказ</Button>;
            })()}
            <time>{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
        </div>)}</div>
      <form className="composer" onSubmit={async event => { event.preventDefault(); if (await core.sendMessage(thread.id, text)) setText(''); }}><Input value={text} onChange={event => setText(event.target.value)} maxLength={1000} placeholder="Сообщение..." aria-label="Сообщение" /><Button type="submit" disabled={!text.trim()} busy={core.actionBusy === `message-${thread.id}`}>➤</Button></form>
    </> : <StateView title="Выберите диалог" text="Переписка откроется здесь." />}</div>
    <PublicProfileModal
      profile={peerProfile}
      onClose={() => setPeerProfile(null)}
      core={core}
      onOpenOnix={openOnixProfile}
      onWrite={async (onixId) => {
        setPeerProfile(null);
        await openDirectChat(onixId);
      }}
      onOpenProduct={(productId) => {
        setPeerProfile(null);
        openProductCard(productId);
      }}
      onReport={(onixId) => setReportOnixId(onixId)}
      setToast={setToast}
    />
    <ReportUserModal
      onixId={reportOnixId}
      core={core}
      onClose={() => setReportOnixId(null)}
      setToast={setToast}
    />
  </div>;
}
export default Chats;
