import { useEffect, useRef, useState } from 'react';
import { api, money } from '../api/client';
import { API_PATHS, formatLastSeen, type ChatUserHit, type PublicProfile } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Button, Card, Field, Input, Modal, Skeleton, StateView } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import type { Core } from './types';
import { MessageText, PublicProfileModal, ReportUserModal, StaffBadge, dealLabels } from './shared';

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
  const [chatQuery, setChatQuery] = useState('');
  const [peerProfile, setPeerProfile] = useState<PublicProfile | null>(null);
  const [reportOnixId, setReportOnixId] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupHits, setGroupHits] = useState<ChatUserHit[]>([]);
  const [groupSelected, setGroupSelected] = useState<ChatUserHit[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const isStaff = Boolean(core.profile?.roles.includes('ADMIN') || core.profile?.roles.includes('SUPPORT'));
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

  useEffect(() => {
    const el = messagesRef.current;
    if (!el || !threadId) return;
    el.scrollTop = el.scrollHeight;
  }, [threadId, messages.length, messages[messages.length - 1]?.id]);

  useEffect(() => {
    const q = chatQuery.trim();
    if (!q) {
      void core.refreshChats?.();
      return;
    }
    const timer = window.setTimeout(() => {
      void core.searchChats?.(q);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [chatQuery, core]);

  useEffect(() => {
    const q = groupSearch.trim();
    if (!groupOpen || q.length < 1) {
      setGroupHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api.get<ChatUserHit[]>(API_PATHS.chatUserSearch(q)).then(setGroupHits).catch(() => setGroupHits([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [groupOpen, groupSearch]);

  const deleteMessage = async (messageId: string, scope: 'self' | 'global') => {
    try {
      await api.delete(API_PATHS.messageDelete(threadId, messageId, scope));
      await core.loadMessages(threadId);
      setToast(scope === 'global' ? 'Сообщение удалено.' : 'Сообщение скрыто у вас.');
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Не удалось удалить.');
    }
  };

  const createGroup = async () => {
    if (!groupTitle.trim() || groupSelected.length < 1) return;
    setGroupBusy(true);
    try {
      const created = await api.post<{ id: string }>(API_PATHS.createGroupChat, {
        title: groupTitle.trim(),
        memberOnixIds: groupSelected.map((u) => u.onixId),
      });
      await core.refreshChats?.();
      setGroupOpen(false);
      setGroupTitle('');
      setGroupSearch('');
      setGroupSelected([]);
      setThreadId(created.id);
      setToast('Группа создана.');
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Не удалось создать группу.');
    } finally {
      setGroupBusy(false);
    }
  };

  if (core.states.chats === 'loading') return <Card><Skeleton lines={6} /></Card>;
  return <div className="chat-layout">
    <div className={`thread-list ${thread ? 'mobile-hidden' : ''}`}>
      <div className="chat-toolbar">
        <Input
          value={chatQuery}
          onChange={(event) => setChatQuery(event.target.value)}
          placeholder="🔍 Поиск: ONIX ID, ник"
          aria-label="Поиск чатов"
        />
        <Button type="button" variant="secondary" aria-label="Создать группу" onClick={() => setGroupOpen(true)}>+</Button>
      </div>
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
      <small>{thread.kind === 'GROUP' ? 'Группа' : formatLastSeen(thread.peerLastOnline)}</small></div>
      {thread.peerOnixId && core.profile?.onixId !== thread.peerOnixId && (
        <Button variant="ghost" onClick={() => setReportOnixId(thread.peerOnixId!)}>Пожаловаться</Button>
      )}
      </div>
      {thread.orderCard && <div className="order-card-inline" role="region" aria-label="Карточка заказа">
        <div><small>Заказ #{thread.orderCard.id}</small><b>{thread.orderCard.productTitle}</b>
          <span>{money(thread.orderCard.totalAmountCents)} · {dealLabels[thread.orderCard.status]} · Escrow</span></div>
        <Button variant="secondary" onClick={() => openDeal(thread.dealId || thread.orderCard!.id)}>Открыть заказ</Button>
      </div>}
      <div className="messages" ref={messagesRef}>{messages.length === 0 ? <StateView title="Начните разговор" text="Сообщения сделки хранятся внутри ONIX." /> : messages.map(message =>
        <div className={`message-row ${message.mine ? 'mine' : ''} ${message.kind === 'SYSTEM' ? 'system' : ''}`} key={message.id}>
          {!message.mine && <UserAvatar avatarUrl={message.kind === 'SYSTEM' ? undefined : message.sender.avatarUrl} name={message.sender.username} />}
          <div className={`message ${message.mine ? 'mine' : ''} ${message.kind === 'SYSTEM' ? 'system' : ''} ${message.deleted ? 'deleted' : ''}`}>
            {message.kind !== 'SYSTEM' && <small>@{message.sender.username} <StaffBadge badge={message.sender.badge} /></small>}
            {message.kind === 'SYSTEM' && <small>🛡 ONIX</small>}
            <p><MessageText text={isStaff && message.deleted && message.originalText ? message.originalText : message.text} onOpenOnix={openOnixProfile} /></p>
            {isStaff && message.deleted && <small className="receipt-admin">удалено · {message.deletedAt ? new Date(message.deletedAt).toLocaleString('ru-RU') : ''}</small>}
            {message.mine && message.deliveryStatus && (
              <small className="receipt" title={message.deliveryStatus === 'READ' ? 'Прочитано' : 'Отправлено'}>
                {message.deliveryStatus === 'READ' ? '✓✓' : '✓'}
              </small>
            )}
            {isStaff && message.readBy && message.readBy.length > 0 && (
              <small className="receipt-admin">
                прочитали: {message.readBy.map((r) => `${r.username} ${new Date(r.readAt).toLocaleString('ru-RU')}`).join('; ')}
              </small>
            )}
            {message.kind === 'SYSTEM' && message.text.includes('Заказ создан') && (() => {
              const orderId = message.text.match(/Заказ #(\d+)/)?.[1]
                || thread.dealId
                || thread.orderCard?.id;
              if (!orderId) return null;
              return <Button variant="secondary" onClick={() => openDeal(orderId)}>Открыть заказ</Button>;
            })()}
            {message.kind !== 'SYSTEM' && (
              <div className="message-actions">
                <button type="button" className="linkish" onClick={() => void deleteMessage(message.id, 'self')}>Удалить у себя</button>
                {isStaff && !message.deleted && (
                  <button type="button" className="linkish" onClick={() => void deleteMessage(message.id, 'global')}>Удалить</button>
                )}
              </div>
            )}
            <time>{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
        </div>)}</div>
      <form className="composer" onSubmit={async event => { event.preventDefault(); if (await core.sendMessage(thread.id, text)) setText(''); }}>
        <Input value={text} onChange={event => setText(event.target.value)} maxLength={1000} placeholder="Введите сообщение..." aria-label="Сообщение" />
        <Button type="submit" disabled={!text.trim()} busy={core.actionBusy === `message-${thread.id}`}>Отправить</Button>
      </form>
    </> : <StateView title="Выберите диалог" text="Переписка откроется здесь." />}</div>
    <Modal open={groupOpen} title="Создать группу" onClose={() => setGroupOpen(false)}>
      <div className="form">
        <Field label="Название"><Input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} maxLength={80} /></Field>
        <Field label="Добавить пользователей"><Input value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} placeholder="ONIX-1 или ник" /></Field>
        {groupHits.length > 0 && <div className="chips">
          {groupHits.map((hit) => (
            <button
              key={hit.onixId}
              type="button"
              className={groupSelected.some((s) => s.onixId === hit.onixId) ? 'active' : ''}
              onClick={() => {
                setGroupSelected((prev) => (
                  prev.some((s) => s.onixId === hit.onixId)
                    ? prev.filter((s) => s.onixId !== hit.onixId)
                    : [...prev, hit]
                ));
              }}
            >{formatOnixId(hit.onixId)} · @{hit.username}</button>
          ))}
        </div>}
        {groupSelected.length > 0 && <p className="muted">Выбрано: {groupSelected.map((s) => formatOnixId(s.onixId)).join(', ')}</p>}
        <div className="modal__actions">
          <Button variant="secondary" onClick={() => setGroupOpen(false)}>Отмена</Button>
          <Button busy={groupBusy} disabled={!groupTitle.trim() || groupSelected.length < 1} onClick={() => void createGroup()}>Создать</Button>
        </div>
      </div>
    </Modal>
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
