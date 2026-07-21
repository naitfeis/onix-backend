import { useEffect, useRef, useState } from 'react';
import { api, friendlyError, money } from '../api/client';
import { API_PATHS, formatLastSeen, isOnline, type ChatMemberItem, type ChatUserHit, type Product, type PublicProfile } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Button, Card, Confirm, Field, Input, Modal, Skeleton, StateView } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { parseMemberTokens } from '../utils/parseMemberTokens';
import { publicAt } from '../utils/publicAt';
import type { Core } from './types';
import { MessageText, PublicProfileModal, ReportUserModal, StaffBadge, dealLabels } from './shared';

const NEAR_BOTTOM_PX = 96;
const LONG_PRESS_MS = 480;

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
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupHits, setGroupHits] = useState<ChatUserHit[]>([]);
  const [groupSelected, setGroupSelected] = useState<ChatUserHit[]>([]);
  const [groupErrors, setGroupErrors] = useState<string[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);
  const [menuMessageId, setMenuMessageId] = useState<string | null>(null);
  const [pendingNewCount, setPendingNewCount] = useState(0);
  const [aiActionsOpen, setAiActionsOpen] = useState(false);
  const [leaveGroupId, setLeaveGroupId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<ChatMemberItem[] | null>(null);
  const [groupMembersTitle, setGroupMembersTitle] = useState('');
  const groupPressRef = useRef<number | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const prevChatQueryRef = useRef('');
  const lastSeenMsgIdRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const isStaff = Boolean(
    core.profile?.isAdmin
    || core.profile?.status === 'ADMIN'
    || core.profile?.status === 'SUPER_ADMIN'
    || core.profile?.status === 'MODERATOR'
    || core.profile?.roles.includes('ADMIN')
    || core.profile?.roles.includes('SUPER_ADMIN')
    || core.profile?.roles.includes('MODERATOR'),
  );
  const canSeeReadReceipts = Boolean(
    core.profile?.status === 'ADMIN'
    || core.profile?.status === 'MODERATOR'
    || core.profile?.roles.includes('ADMIN')
    || core.profile?.roles.includes('MODERATOR'),
  );
  const isAdmin = Boolean(core.profile?.roles.includes('ADMIN'));
  const thread = core.chats.find(item => item.id === threadId);
  const messages = threadId ? core.messages[threadId] || [] : [];
  const { loadMessages, searchChats, refreshChats, sendMessage } = core;
  const memberPickerOpen = groupOpen || addMembersOpen;

  const openOnixProfile = async (onixId: string) => {
    if (peerProfile?.onixId === onixId) return;
    try { setPeerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(onixId))); } catch { /* ignore */ }
  };

  const openLot = async (lotNumber: number) => {
    try {
      const product = await api.get<Product>(API_PATHS.productByLot(lotNumber));
      openProductCard(product.id);
    } catch (error) {
      setToast(friendlyError(error));
    }
  };

  useEffect(() => {
    if (threadId) void loadMessages(threadId);
  }, [loadMessages, threadId]);

  useEffect(() => {
    if (!focusChatId) return;
    setThreadId(focusChatId);
    onFocusChatHandled();
  }, [focusChatId, onFocusChatHandled]);

  useEffect(() => {
    stickToBottomRef.current = true;
    lastSeenMsgIdRef.current = null;
    setPendingNewCount(0);
    setMenuMessageId(null);
  }, [threadId]);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el || !threadId) return;
    const lastId = messages[messages.length - 1]?.id ?? null;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      lastSeenMsgIdRef.current = lastId;
      setPendingNewCount(0);
      return;
    }
    if (lastId && lastSeenMsgIdRef.current && lastId !== lastSeenMsgIdRef.current) {
      const prevIdx = messages.findIndex((m) => m.id === lastSeenMsgIdRef.current);
      const grown = prevIdx >= 0 ? messages.length - 1 - prevIdx : 1;
      if (grown > 0) setPendingNewCount((n) => n + grown);
    }
  }, [threadId, messages.length, messages[messages.length - 1]?.id]);

  useEffect(() => {
    const q = chatQuery.trim();
    const prev = prevChatQueryRef.current;
    prevChatQueryRef.current = q;

    if (!q) {
      if (prev) void refreshChats();
      return;
    }
    const timer = window.setTimeout(() => {
      void searchChats(q);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [chatQuery, searchChats, refreshChats]);

  useEffect(() => {
    const q = groupSearch.trim();
    if (!memberPickerOpen || q.length < 1) {
      setGroupHits([]);
      return;
    }
    const tokens = parseMemberTokens(q);
    if (tokens.length > 1) {
      setGroupHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api.get<ChatUserHit[]>(API_PATHS.chatUserSearch(tokens[0] ?? q)).then(setGroupHits).catch(() => setGroupHits([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [memberPickerOpen, groupSearch]);

  useEffect(() => () => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
  }, []);

  const resolveGroupMembers = async () => {
    const tokens = parseMemberTokens(groupSearch);
    const selected = [...groupSelected];
    const errors: string[] = [];
    for (const token of tokens) {
      if (selected.some((s) => s.onixId.toLowerCase() === formatOnixId(token).toLowerCase()
        || s.username.toLowerCase() === token.toLowerCase()
        || s.onixId.replace(/^ONIX-/i, '') === token.replace(/^ONIX-/i, ''))) {
        continue;
      }
      try {
        const hits = await api.get<ChatUserHit[]>(API_PATHS.chatUserSearch(token));
        const exact = hits.find((h) => {
          const id = formatOnixId(h.onixId).toLowerCase();
          const bare = id.replace(/^onix-/, '');
          const t = token.toLowerCase().replace(/^onix-/, '').replace(/^@+/, '');
          return id === `onix-${t}` || bare === t || h.username.toLowerCase() === t;
        }) ?? hits[0];
        if (!exact) {
          errors.push(`${formatOnixId(token) || token} не найден`);
          continue;
        }
        if (!selected.some((s) => s.onixId === exact.onixId)) selected.push(exact);
      } catch {
        errors.push(`${formatOnixId(token) || token} не найден`);
      }
    }
    setGroupSelected(selected);
    setGroupErrors(errors);
    if (errors.length) setToast(errors.join('. '));
    return selected;
  };

  const resetMemberPicker = () => {
    setGroupSearch('');
    setGroupSelected([]);
    setGroupErrors([]);
    setGroupHits([]);
  };

  const deleteMessage = async (messageId: string, scope: 'self' | 'global') => {
    setMenuMessageId(null);
    try {
      await api.delete(API_PATHS.messageDelete(threadId, messageId, scope));
      await loadMessages(threadId);
      setToast(scope === 'global' ? 'Сообщение удалено у всех.' : 'Сообщение удалено у вас.');
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Не удалось удалить.');
    }
  };

  const createGroup = async () => {
    if (!groupTitle.trim()) return;
    setGroupBusy(true);
    try {
      const members = groupSelected.length > 0 ? groupSelected : await resolveGroupMembers();
      if (members.length < 1) {
        setToast('Добавьте хотя бы одного участника.');
        return;
      }
      const created = await api.post<{ id: string }>(API_PATHS.createGroupChat, {
        title: groupTitle.trim(),
        memberOnixIds: members.map((u) => u.onixId),
      });
      await refreshChats();
      setGroupOpen(false);
      setGroupTitle('');
      resetMemberPicker();
      setThreadId(created.id);
      setToast('Группа создана.');
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Не удалось создать группу.');
    } finally {
      setGroupBusy(false);
    }
  };

  const addMembers = async () => {
    if (!threadId) return;
    setGroupBusy(true);
    try {
      const members = groupSelected.length > 0 ? groupSelected : await resolveGroupMembers();
      if (members.length < 1) {
        setToast('Укажите участников.');
        return;
      }
      const result = await api.post<{ added: string[]; missing: string[]; already: string[] }>(
        API_PATHS.addChatMembers(threadId),
        { memberOnixIds: members.map((u) => u.onixId) },
      );
      await loadMessages(threadId);
      await refreshChats();
      setAddMembersOpen(false);
      resetMemberPicker();
      const parts = [
        result.added.length ? `Добавлено: ${result.added.join(', ')}` : '',
        result.already.length ? `Уже в группе: ${result.already.join(', ')}` : '',
        result.missing.length ? `Не найдены: ${result.missing.join(', ')}` : '',
      ].filter(Boolean);
      setToast(parts.join('. ') || 'Готово.');
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Не удалось добавить участников.');
    } finally {
      setGroupBusy(false);
    }
  };

  const scrollToLatest = () => {
    const el = messagesRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    el.scrollTop = el.scrollHeight;
    lastSeenMsgIdRef.current = messages[messages.length - 1]?.id ?? null;
    setPendingNewCount(0);
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = (messageId: string) => {
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      setMenuMessageId(messageId);
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  };

  const memberPickerFields = (
    <>
      <Field label="Поиск" hint="ONIX-1 · имя · 7">
        <Input value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} placeholder="ONIX ID или ник" />
      </Field>
      <div className="card-actions">
        <Button type="button" variant="secondary" onClick={() => void resolveGroupMembers()} disabled={!groupSearch.trim()}>
          Добавить из поля
        </Button>
      </div>
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
          >{formatOnixId(hit.onixId)} · {publicAt(hit.username)}</button>
        ))}
      </div>}
      {groupSelected.length > 0 && <p className="muted">Выбрано: {groupSelected.map((s) => formatOnixId(s.onixId)).join(', ')}</p>}
      {groupErrors.length > 0 && <p className="muted">{groupErrors.join('. ')}</p>}
    </>
  );

  if (core.states.chats === 'loading' && core.chats.length === 0) {
    return <Card><Skeleton lines={6} /></Card>;
  }

  return <div className="chat-layout">
    <div className={`thread-list ${thread ? 'mobile-hidden' : ''}`}>
      <div className="chat-toolbar">
        <Input
          value={chatQuery}
          onChange={(event) => setChatQuery(event.target.value)}
          placeholder="🔍 Поиск: ONIX ID, ник"
          aria-label="Поиск чатов"
        />
        <Button type="button" variant="secondary" aria-label="Создать группу" onClick={() => { resetMemberPicker(); setGroupOpen(true); }}>+</Button>
      </div>
      {core.states.chats === 'error' ? <StateView title="Чаты недоступны" text={core.errors.chats || ''} /> : core.chats.length === 0 ? <StateView title="Нет диалогов" text="Напишите продавцу из карточки товара." /> :
        core.chats.map(chat => <button
          className="thread"
          key={chat.id}
          onClick={() => setThreadId(chat.id)}
          onContextMenu={(event) => {
            if (chat.kind !== 'GROUP') return;
            event.preventDefault();
            setLeaveGroupId(chat.id);
          }}
          onPointerDown={() => {
            if (chat.kind !== 'GROUP') return;
            if (groupPressRef.current) window.clearTimeout(groupPressRef.current);
            groupPressRef.current = window.setTimeout(() => setLeaveGroupId(chat.id), 480);
          }}
          onPointerUp={() => { if (groupPressRef.current) { window.clearTimeout(groupPressRef.current); groupPressRef.current = null; } }}
          onPointerLeave={() => { if (groupPressRef.current) { window.clearTimeout(groupPressRef.current); groupPressRef.current = null; } }}
          onPointerCancel={() => { if (groupPressRef.current) { window.clearTimeout(groupPressRef.current); groupPressRef.current = null; } }}
        >
          <span className="thread-peer">
            <UserAvatar
              avatarUrl={chat.kind === 'AI' ? undefined : chat.peerAvatarUrl}
              name={chat.title}
              online={chat.kind === 'GROUP' || chat.kind === 'AI' ? undefined : isOnline(chat.peerLastOnline)}
            />
            <span>
              <b>{chat.title} <StaffBadge badge={chat.peerBadge} /></b>
              <small>
                {chat.kind === 'AI' ? 'Помощник' : chat.kind === 'GROUP' ? 'Группа' : (chat.subtitle || 'Открыть диалог')}
              </small>
            </span>
          </span>
          {chat.unreadCount > 0 && <em>{chat.unreadCount}</em>}
        </button>)}</div>
    <div className={`conversation ${!thread ? 'mobile-hidden' : ''}`}>{thread ? <><div className="conversation__head"><Button variant="ghost" className="back" onClick={() => setThreadId('')}>←</Button>
      <button
        type="button"
        className="conversation__peer"
        disabled={thread.kind === 'AI' || (thread.kind !== 'GROUP' && !thread.peerOnixId)}
        aria-label={thread.kind === 'GROUP' ? `Участники ${thread.title}` : (thread.peerOnixId ? `Профиль ${thread.title}` : undefined)}
        onClick={async () => {
          if (thread.kind === 'AI') return;
          if (thread.kind === 'GROUP') {
            try {
              const data = await api.get<{ title?: string; members: ChatMemberItem[] }>(API_PATHS.chatMembers(thread.id));
              setGroupMembersTitle(data.title || thread.title);
              setGroupMembers(data.members);
            } catch {
              setToast('Не удалось загрузить участников');
            }
            return;
          }
          if (!thread.peerOnixId) return;
          if (peerProfile?.onixId === thread.peerOnixId) return;
          try { setPeerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(thread.peerOnixId))); } catch { /* ignore */ }
        }}
      >
        {(thread.peerAvatarUrl !== undefined || thread.title) ? (
          <UserAvatar
            avatarUrl={thread.kind === 'AI' ? undefined : thread.peerAvatarUrl}
            name={thread.title}
            online={thread.kind === 'GROUP' || thread.kind === 'AI' ? undefined : isOnline(thread.peerLastOnline)}
          />
        ) : null}
        <div>
          <b>{thread.title} <StaffBadge badge={thread.peerBadge} /></b>
          <small>
            {thread.kind === 'AI' ? 'Помощник платформы' : thread.kind === 'GROUP' ? 'Группа' : formatLastSeen(thread.peerLastOnline)}
          </small>
        </div>
      </button>
      {thread.kind === 'GROUP' && (
        <Button
          variant="ghost"
          aria-label="Добавить участников"
          onClick={() => { resetMemberPicker(); setAddMembersOpen(true); }}
        >+</Button>
      )}
      {thread.peerOnixId && core.profile?.onixId !== thread.peerOnixId && (
        <Button variant="ghost" onClick={() => setReportOnixId(thread.peerOnixId!)}>Пожаловаться</Button>
      )}
      </div>
      {thread.orderCard && <div className="order-card-inline" role="region" aria-label="Карточка заказа">
        <div><small>Заказ #{thread.orderCard.id}</small><b>{thread.orderCard.productTitle}</b>
          <span>{money(thread.orderCard.totalAmountCents)} · {dealLabels[thread.orderCard.status]} · Escrow</span></div>
        <Button variant="secondary" onClick={() => openDeal(thread.dealId || thread.orderCard!.id)}>Открыть заказ</Button>
      </div>}
      <div className="messages-wrap">
      <div
        className="messages"
        ref={messagesRef}
        onScroll={() => {
          const el = messagesRef.current;
          if (!el) return;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
          stickToBottomRef.current = nearBottom;
          if (nearBottom) {
            lastSeenMsgIdRef.current = messages[messages.length - 1]?.id ?? null;
            setPendingNewCount(0);
          }
        }}
        onClick={() => setMenuMessageId(null)}
      >{messages.length === 0 ? <StateView title="Начните разговор" text="Сообщения сделки хранятся внутри ONIX." /> : messages.map(message =>
        <div className={`message-row ${message.mine ? 'mine' : ''} ${message.kind === 'SYSTEM' ? 'system' : ''}`} key={message.id}>
          {!message.mine && <UserAvatar avatarUrl={message.kind === 'SYSTEM' ? undefined : message.sender.avatarUrl} name={message.sender.username} />}
          <div
            className={`message ${message.mine ? 'mine' : ''} ${message.kind === 'SYSTEM' ? 'system' : ''} ${message.deleted ? 'deleted' : ''}`}
            onContextMenu={(event) => {
              if (message.kind === 'SYSTEM' || message.deleted) return;
              event.preventDefault();
              setMenuMessageId(message.id);
            }}
            onPointerDown={() => {
              if (message.kind === 'SYSTEM' || message.deleted) return;
              startLongPress(message.id);
            }}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
          >
            {message.kind !== 'SYSTEM' && <small>{publicAt(message.sender.username)} <StaffBadge badge={message.sender.badge} /></small>}
            {message.kind === 'SYSTEM' && <small>{thread.kind === 'AI' ? 'ONIX AI' : '🛡 ONIX'}</small>}
            <p><MessageText
              text={isStaff && message.deleted && message.originalText ? message.originalText : message.text}
              onOpenOnix={openOnixProfile}
              onOpenLot={(lot) => void openLot(lot)}
            /></p>
            {isStaff && message.deleted && <small className="receipt-admin">удалено · {message.deletedAt ? new Date(message.deletedAt).toLocaleString('ru-RU') : ''}</small>}
            {message.mine && message.deliveryStatus && (
              <small className="receipt" title={message.deliveryStatus === 'READ' ? 'Прочитано' : 'Отправлено'}>
                {message.deliveryStatus === 'READ' ? '✓✓' : '✓'}
              </small>
            )}
            {canSeeReadReceipts && message.readBy && message.readBy.length > 0 && (
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
            {thread.kind === 'AI' && message.kind === 'SYSTEM' && /Опубликовать|Изменить/i.test(message.text) && message.text.includes('Проверьте карточку') && (
              <div className="card-actions">
                <Button busy={core.actionBusy === `message-${thread.id}`} onClick={() => void sendMessage(thread.id, 'Опубликовать').then((ok) => { if (ok) void loadMessages(thread.id); })}>Опубликовать</Button>
                <Button variant="secondary" busy={core.actionBusy === `message-${thread.id}`} onClick={() => void sendMessage(thread.id, 'Изменить').then((ok) => { if (ok) void loadMessages(thread.id); })}>Изменить</Button>
              </div>
            )}
            {thread.kind === 'AI' && message.kind === 'SYSTEM' && /Товар опубликован/i.test(message.text) && (() => {
              const lot = message.text.match(/ONIXLOT-(\d+)/i)?.[1];
              if (!lot) return null;
              return <Button variant="secondary" onClick={() => void openLot(Number(lot))}>Открыть товар</Button>;
            })()}
            {menuMessageId === message.id && message.kind !== 'SYSTEM' && !message.deleted && (
              <div className="message-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                <button type="button" role="menuitem" onClick={() => void deleteMessage(message.id, 'self')}>
                  Удалить у меня
                </button>
                {(message.mine || isAdmin) && (
                  <button type="button" role="menuitem" onClick={() => void deleteMessage(message.id, 'global')}>
                    Удалить у всех
                  </button>
                )}
              </div>
            )}
            <time>{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
        </div>)}</div>
      {pendingNewCount > 0 && (
        <button type="button" className="new-messages-pill" onClick={scrollToLatest}>
          ↓ Новые ({pendingNewCount})
        </button>
      )}
      </div>
      {thread.kind === 'AI' && (
        <div className={`ai-actions ${aiActionsOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className="ai-actions__toggle"
            aria-expanded={aiActionsOpen}
            aria-controls={`ai-actions-${thread.id}`}
            onClick={() => setAiActionsOpen((open) => !open)}
          >
            <span>Действия ONIX AI</span>
            <span className="ai-actions__chevron" aria-hidden="true">{aiActionsOpen ? '▼' : '▲'}</span>
          </button>
          {aiActionsOpen && (
            <div className="ai-quick-replies" id={`ai-actions-${thread.id}`} role="group" aria-label="Быстрые действия">
              {[
                { label: 'О площадке ONIX', send: 'О площадке ONIX' },
                { label: 'Добавить товар', send: 'Добавить товар' },
                { label: 'Вывести деньги', send: 'Вывести деньги' },
                { label: 'Написать в поддержку', send: 'Написать в поддержку' },
                { label: 'Как работает система гаранта', send: 'Как работает система гаранта' },
                { label: 'Сколько ждать вывод', send: 'Сколько ждать вывод' },
              ].map((item) => (
                <button
                  key={item.send}
                  type="button"
                  className="ai-quick-replies__btn"
                  disabled={Boolean(core.actionBusy === `message-${thread.id}`)}
                  onClick={() => void sendMessage(thread.id, item.send).then((ok) => { if (ok) void loadMessages(thread.id); })}
                >{item.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <form className="composer" onSubmit={async event => {
        event.preventDefault();
        const sent = text;
        if (await sendMessage(thread.id, text)) {
          setText('');
          if (thread.kind === 'AI') await loadMessages(thread.id);
          else void sent;
        }
      }}>
        <Input value={text} onChange={event => setText(event.target.value)} maxLength={1000} placeholder="Введите сообщение..." aria-label="Сообщение" />
        <Button type="submit" disabled={!text.trim()} busy={core.actionBusy === `message-${thread.id}`}>Отправить</Button>
      </form>
    </> : <StateView title="Выберите диалог" text="Переписка откроется здесь." />}</div>
    <Modal open={groupOpen} title="Создать группу" onClose={() => { setGroupOpen(false); resetMemberPicker(); }}>
      <div className="form">
        <Field label="Название"><Input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} maxLength={80} /></Field>
        <p className="muted">Добавить участников</p>
        {memberPickerFields}
        <div className="modal__actions">
          <Button type="button" variant="secondary" onClick={() => { setGroupOpen(false); resetMemberPicker(); }}>Отмена</Button>
          <Button type="button" busy={groupBusy} disabled={!groupTitle.trim()} onClick={() => void createGroup()}>Создать</Button>
        </div>
      </div>
    </Modal>
    <Modal open={addMembersOpen} title="Добавить участников" onClose={() => { setAddMembersOpen(false); resetMemberPicker(); }}>
      <div className="form">
        {memberPickerFields}
        <div className="modal__actions">
          <Button type="button" variant="secondary" onClick={() => { setAddMembersOpen(false); resetMemberPicker(); }}>Отмена</Button>
          <Button type="button" busy={groupBusy} onClick={() => void addMembers()}>Добавить</Button>
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
    <Confirm
      open={Boolean(leaveGroupId)}
      title="Выйти из группы?"
      text="Чат исчезнет из списка. Вернуться можно только по новому приглашению."
      dangerous
      onCancel={() => setLeaveGroupId(null)}
      onConfirm={async () => {
        if (!leaveGroupId) return;
        const id = leaveGroupId;
        setLeaveGroupId(null);
        try {
          await api.delete(API_PATHS.leaveGroupChat(id));
          if (threadId === id) setThreadId('');
          await core.refreshChats();
          setToast('Вы вышли из группы');
        } catch (error) {
          setToast(error instanceof Error ? error.message : 'Не удалось выйти');
        }
      }}
    />
    <Modal open={groupMembers != null} title={groupMembersTitle || 'Участники'} onClose={() => setGroupMembers(null)}>
      <div className="stack compact">
        {(groupMembers ?? []).length === 0
          ? <StateView title="Нет участников" text="Список пуст." />
          : (groupMembers ?? []).map((member) => (
            <button
              type="button"
              key={member.onixId}
              className="thread"
              onClick={async () => {
                setGroupMembers(null);
                try { setPeerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(member.onixId))); } catch { /* ignore */ }
              }}
            >
              <span className="thread-peer">
                <UserAvatar
                  avatarUrl={member.avatarUrl}
                  name={member.username}
                  online={isOnline(member.lastOnline)}
                />
                <span>
                  <b>{publicAt(member.username)} <StaffBadge badge={member.badge} /></b>
                  <small>{formatOnixId(member.onixId)} · {formatLastSeen(member.lastOnline)}</small>
                </span>
              </span>
            </button>
          ))}
      </div>
    </Modal>
  </div>;
}
export default Chats;
