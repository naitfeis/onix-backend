import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { api, friendlyError, money } from '../api/client';
import { API_PATHS, formatLastSeen, sellerIsPresent, type ChatMemberItem, type ChatUserHit, type Product, type PublicProfile } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Button, Card, Confirm, Field, Input, Modal, Skeleton, StateView } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { parseMemberTokens } from '../utils/parseMemberTokens';
import { publicAt } from '../utils/publicAt';
import type { Core } from './types';
import { MessageText, PublicProfileModal, ReportUserModal, StaffBadge, dealLabels } from './shared';
import { playSound, unlockSounds } from '../audio/sounds';
import { getRealtimeClient } from '../realtime/client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { t } from '../i18n';

const NEAR_BOTTOM_PX = 96;
const LONG_PRESS_MS = 480;
const CHAT_LIST_W_KEY = 'onix-chat-list-w';
const CHAT_LIST_DEFAULT = 320;
const CHAT_LIST_MIN = 220;

function readStoredChatSize(key: string, fallback: number, min: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= min ? Math.round(n) : fallback;
  } catch {
    return fallback;
  }
}

export function Chats({
  core, focusChatId, onFocusChatHandled, openDirectChat, openProductCard, openDeal, setToast, active = true,
}: {
  core: Core;
  focusChatId: string | null;
  onFocusChatHandled: () => void;
  openDirectChat: (onixId: string) => Promise<boolean>;
  openProductCard: (productId: string) => void;
  openDeal: (dealId: string) => void;
  setToast: (text: string) => void;
  /** False while another tab is shown (keep-alive). */
  active?: boolean;
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
  const [leaveGroupId, setLeaveGroupId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<ChatMemberItem[] | null>(null);
  const [groupMembersTitle, setGroupMembersTitle] = useState('');
  const groupPressRef = useRef<number | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const prevChatQueryRef = useRef('');
  const lastSeenMsgIdRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const thread = core.chats.find(item => item.id === threadId);
  const rawMessages = threadId ? core.messages[threadId] || [] : [];
  const messages = useMemo(() => {
    const seenIds = new Set<string>();
    const out: typeof rawMessages = [];
    for (const row of rawMessages) {
      const id = String(row.id);
      if (!id || seenIds.has(id)) continue;
      if (row.kind !== 'SYSTEM' && !row.text?.trim() && !row.attachment) continue;
      const prev = out[out.length - 1];
      if (
        prev
        && prev.kind !== 'SYSTEM'
        && row.kind !== 'SYSTEM'
        && prev.mine === row.mine
        && prev.sender.id === row.sender.id
        && prev.text === row.text
        && Math.abs(new Date(prev.createdAt).getTime() - new Date(row.createdAt).getTime()) < 4000
      ) {
        continue;
      }
      seenIds.add(id);
      out.push({ ...row, id });
    }
    return out;
  }, [rawMessages]);
  const messageVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => messagesRef.current,
    estimateSize: () => 92,
    overscan: 10,
    getItemKey: (index) => messages[index]?.id ?? index,
  });
  const { loadMessages, searchChats, refreshChats, sendMessage } = core;
  const memberPickerOpen = groupOpen || addMembersOpen;
  const [typingLabel, setTypingLabel] = useState<string | null>(null);
  const typingClearRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef(0);
  const [aiFaqs, setAiFaqs] = useState<Array<{ id: string; title: string }>>([]);
  const [aiFaqsOpen, setAiFaqsOpen] = useState(true);
  const [listW, setListW] = useState(() => readStoredChatSize(CHAT_LIST_W_KEY, CHAT_LIST_DEFAULT, CHAT_LIST_MIN));

  const startListResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = listW;
    const target = event.currentTarget;
    const layout = target.closest('.chat-layout') as HTMLElement | null;
    target.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-chat');
    let latest = startW;
    let raf = 0;
    const apply = (next: number) => {
      latest = next;
      layout?.style.setProperty('--chat-list-w', `${next}px`);
    };
    const onMove = (ev: PointerEvent) => {
      const max = Math.floor((layout?.clientWidth || window.innerWidth) * 0.5);
      const next = Math.max(CHAT_LIST_MIN, Math.min(max, startW + (ev.clientX - startX)));
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => apply(next));
    };
    const onUp = (ev: PointerEvent) => {
      try { target.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      if (raf) cancelAnimationFrame(raf);
      document.body.classList.remove('is-resizing-chat');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const rounded = Math.round(latest);
      setListW(rounded);
      try { localStorage.setItem(CHAT_LIST_W_KEY, String(rounded)); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
  };

  const openOnixProfile = async (onixId: string) => {
    const id = formatOnixId(onixId) || onixId;
    if (!id) return;
    try {
      setPeerProfile(await api.get<PublicProfile>(API_PATHS.userPublic(id)));
    } catch (error) {
      setToast(friendlyError(error));
    }
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
    void api.get<{ id: string; faqs?: Array<{ id: string; title: string }> }>(API_PATHS.aiChat)
      .then((chat) => {
        if (chat.faqs) setAiFaqs(chat.faqs);
        if (chat.id) core.subscribeRealtimeChat(chat.id);
        void refreshChats();
      })
      .catch(() => { /* AI optional */ });
  }, [refreshChats, core.subscribeRealtimeChat]);

  useEffect(() => {
    if (threadId) void loadMessages(threadId);
  }, [loadMessages, threadId]);

  useEffect(() => {
    if (!active) {
      core.setActiveChatId(null);
      return;
    }
    core.setActiveChatId(threadId || null);
    return () => core.setActiveChatId(null);
  }, [active, threadId, core.setActiveChatId]);

  useEffect(() => {
    if (!active || !threadId) return;
    core.setActiveChatId(threadId);
  }, [active, threadId, core.notifications, core.setActiveChatId]);

  useEffect(() => {
    if (!active || !threadId) return;
    core.subscribeRealtimeChat(threadId);
    return () => core.unsubscribeRealtimeChat(threadId);
  }, [active, threadId, core.subscribeRealtimeChat, core.unsubscribeRealtimeChat]);

  // HTTP fallback only when the socket is down — WS is the live path.
  useEffect(() => {
    if (!active || !threadId) return;
    const tick = () => {
      if (getRealtimeClient().isReady()) return;
      void loadMessages(threadId);
    };
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [active, threadId, loadMessages]);

  useEffect(() => {
    if (!active || !threadId) return;
    const off = getRealtimeClient().onMessage((msg) => {
      if (msg.type !== 'chat.typing' || msg.chatId !== threadId) return;
      setTypingLabel(`${msg.username} печатает…`);
      if (typingClearRef.current != null) window.clearTimeout(typingClearRef.current);
      typingClearRef.current = window.setTimeout(() => setTypingLabel(null), 2500);
    });
    return () => {
      off();
      if (typingClearRef.current != null) window.clearTimeout(typingClearRef.current);
    };
  }, [active, threadId]);

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
      if (lastId) {
        requestAnimationFrame(() => messageVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' }));
      }
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
    if (messages.length > 0) messageVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
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

  return <div
    className="chat-layout"
    style={{ '--chat-list-w': `${listW}px` } as CSSProperties}
  >
    <div className={`thread-list ${thread ? 'mobile-hidden' : ''}`}>
      <div className="chat-list-head">
        <div className="chat-toolbar">
          <Input
            value={chatQuery}
            onChange={(event) => setChatQuery(event.target.value)}
            placeholder={t('chat.search')}
            aria-label={t('chat.searchAria')}
          />
          <Button type="button" variant="secondary" aria-label="Создать группу" onClick={() => { resetMemberPicker(); setGroupOpen(true); }}>+</Button>
        </div>
      </div>
      {core.states.chats === 'error' ? <StateView title="Чаты недоступны" text={core.errors.chats || ''} /> : core.chats.length === 0 ? <StateView title={t('chat.emptyTitle')} text={t('chat.emptyText')} /> :
        core.chats.map(chat => <button
          className={`thread${threadId === chat.id ? ' active' : ''}`}
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
              userId={chat.kind === 'AI' ? undefined : chat.peerUserId}
              avatarUrl={chat.kind === 'AI' ? undefined : chat.peerAvatarUrl}
              name={chat.kind === 'AI' ? 'Onix AI' : chat.title}
              initials={chat.kind === 'AI' ? 'AI' : undefined}
              online={chat.kind === 'GROUP' || chat.kind === 'AI' || !chat.peerOnixId
                ? undefined
                : sellerIsPresent(
                  { onixId: chat.peerOnixId, lastOnline: chat.peerLastOnline },
                  core.profile,
                  core.presenceOf(chat.peerOnixId),
                )}
            />
            <span>
              <b title={chat.kind === 'AI' ? 'Onix AI' : chat.title}>
                {chat.kind === 'AI' ? 'Onix AI' : chat.title} <StaffBadge badge={chat.peerBadge} />
              </b>
              <small>
                {chat.kind === 'AI' ? (chat.subtitle || 'Помощник') : chat.kind === 'GROUP' ? 'Группа' : (chat.subtitle || 'Открыть диалог')}
              </small>
            </span>
          </span>
          {chat.unreadCount > 0 && <em>{chat.unreadCount}</em>}
        </button>)}</div>
    <button
      type="button"
      className="chat-col-resizer chat-col-resizer--list desktop-only"
      aria-label="Изменить ширину списка чатов"
      onPointerDown={startListResize}
    />
    <div className={`conversation ${!thread ? 'mobile-hidden' : ''}`}>{thread ? <><div className="conversation__head"><Button variant="ghost" className="back" onClick={() => setThreadId('')}>←</Button>
      <button
        type="button"
        className="conversation__peer"
        disabled={thread.kind !== 'GROUP' && !thread.peerOnixId}
        aria-label={thread.kind === 'GROUP' ? `Участники ${thread.title}` : (thread.peerOnixId ? `Профиль ${thread.title}` : undefined)}
        onClick={async () => {
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
          await openOnixProfile(thread.peerOnixId);
        }}
      >
        {(thread.kind === 'AI' || thread.peerAvatarUrl !== undefined || thread.title) ? (
          <UserAvatar
            userId={thread.kind === 'AI' ? undefined : thread.peerUserId}
            avatarUrl={thread.kind === 'AI' ? undefined : thread.peerAvatarUrl}
            name={thread.kind === 'AI' ? 'Onix AI' : thread.title}
            initials={thread.kind === 'AI' ? 'AI' : undefined}
            online={thread.kind === 'GROUP' || thread.kind === 'AI' || !thread.peerOnixId
              ? undefined
              : sellerIsPresent(
                { onixId: thread.peerOnixId, lastOnline: thread.peerLastOnline },
                core.profile,
                core.presenceOf(thread.peerOnixId),
              )}
          />
        ) : null}
        <div>
          <b title={thread.kind === 'AI' ? 'Onix AI' : thread.title}>
            {thread.kind === 'AI' ? 'Onix AI' : thread.title} <StaffBadge badge={thread.peerBadge} />
          </b>
          <small>
            {thread.kind === 'GROUP'
              ? 'Группа'
              : thread.kind === 'AI'
                ? 'Помощник'
                : `${thread.peerOnixId ? `${formatOnixId(thread.peerOnixId)} · ` : ''}${formatLastSeen(core.presenceOf(thread.peerOnixId ?? '')?.lastOnline ?? thread.peerLastOnline)}`}
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
          <span>{money(thread.orderCard.totalAmountCents)} · {dealLabels[thread.orderCard.status]} · деньги в сейфе</span></div>
        <Button variant="primary" className="order-card-inline__cta" onClick={() => openDeal(thread.dealId || thread.orderCard!.id)}>Открыть заказ</Button>
      </div>}
      <div className="messages-wrap">
      <div
        className="messages messages--virtual"
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
      >{messages.length === 0 ? <StateView title="Начните разговор" text="Сообщения сделки хранятся внутри ONIX." /> :
        <div className="messages__virtual-list" style={{ height: messageVirtualizer.getTotalSize(), position: 'relative' }}>
        {messageVirtualizer.getVirtualItems().map((virtualRow) => {
          const message = messages[virtualRow.index]!;
          return <div
            className="messages__virtual-row"
            key={`${virtualRow.index}-${message.id}`}
            data-index={virtualRow.index}
            ref={messageVirtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
        <div className={`message-row ${message.mine ? 'mine' : ''} ${message.kind === 'SYSTEM' ? 'system' : ''}`}>
          {!message.mine && <UserAvatar userId={message.kind === 'SYSTEM' || thread.kind === 'AI' ? undefined : message.sender.id} avatarUrl={message.kind === 'SYSTEM' || thread.kind === 'AI' ? undefined : message.sender.avatarUrl} name={thread.kind === 'AI' ? 'Onix AI' : message.sender.username} initials={thread.kind === 'AI' ? 'AI' : undefined} />}
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
            {message.kind === 'SYSTEM' && <small>{thread.kind === 'AI' ? 'Onix AI' : '🛡 ONIX'}</small>}
            <p><MessageText
              text={message.text}
              onOpenOnix={openOnixProfile}
              onOpenLot={(lot) => void openLot(lot)}
            /></p>
            {message.kind === 'SYSTEM' && message.text.includes('Заказ создан') && (() => {
              const orderId = message.text.match(/Заказ #(\d+)/)?.[1]
                || thread.dealId
                || thread.orderCard?.id;
              if (!orderId) return null;
              return <Button variant="primary" onClick={() => openDeal(orderId)}>Открыть заказ</Button>;
            })()}
            {menuMessageId === message.id && message.kind !== 'SYSTEM' && !message.deleted && (
              <div className="message-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                <button type="button" role="menuitem" onClick={() => void deleteMessage(message.id, 'self')}>
                  Удалить у меня
                </button>
                {message.mine && (
                  <button type="button" role="menuitem" onClick={() => void deleteMessage(message.id, 'global')}>
                    Удалить у всех
                  </button>
                )}
              </div>
            )}
            <div className="message__meta">
              {message.mine && message.deliveryStatus ? (
                <div className="message__meta-status">
                  <span className="receipt" aria-label={message.deliveryStatus === 'READ' ? 'Прочитано' : 'Отправлено'}>
                    {message.deliveryStatus === 'READ' ? '✓✓' : '✓'}
                  </span>
                  {message.deliveryStatus === 'READ' ? (
                    <span
                      className="receipt-admin"
                      title={
                        message.readBy && message.readBy.length > 0
                          ? message.readBy.map((r) => `${r.username}: ${new Date(r.readAt).toLocaleString('ru-RU')}`).join('\n')
                          : 'Прочитано'
                      }
                    >
                      прочитано
                    </span>
                  ) : null}
                </div>
              ) : null}
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </time>
            </div>
          </div>
        </div>
        </div>;
        })}
        </div>}</div>
      {pendingNewCount > 0 && (
        <button type="button" className="new-messages-pill" onClick={scrollToLatest}>
          ↓ {t('chat.newMessages')} ({pendingNewCount})
        </button>
      )}
      {thread.kind === 'AI' && aiFaqs.length > 0 && (
        <div className={`ai-actions${aiFaqsOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            className="ai-actions__toggle"
            aria-expanded={aiFaqsOpen}
            onClick={() => setAiFaqsOpen((open) => !open)}
          >
            Вопросы помощника
            <span className="ai-actions__chevron" aria-hidden="true">{aiFaqsOpen ? '▼' : '▲'}</span>
          </button>
          {aiFaqsOpen && (
            <div className="ai-quick-replies" role="list" aria-label="Популярные вопросы">
              {aiFaqs.map((faq) => (
                <button
                  type="button"
                  className="ai-quick-replies__btn"
                  role="listitem"
                  key={faq.id}
                  onClick={async () => {
                    try {
                      unlockSounds();
                      await api.post(API_PATHS.aiMessages, { faqId: faq.id, text: faq.title });
                      if (!getRealtimeClient().isReady()) playSound('notify');
                      await loadMessages(thread.id);
                      setAiFaqsOpen(false);
                    } catch (error) {
                      setToast(friendlyError(error));
                    }
                  }}
                >{faq.title}</button>
              ))}
            </div>
          )}
        </div>
      )}
      </div>
      <form className="composer" onSubmit={async event => {
        event.preventDefault();
        const payload = text.trim();
        if (!payload) return;
        setText('');
        if (thread.kind === 'AI') {
          try {
            unlockSounds();
            await api.post(API_PATHS.aiMessages, { text: payload });
            if (!getRealtimeClient().isReady()) playSound('notify');
            await loadMessages(thread.id);
          } catch (error) {
            setText(payload);
            setToast(friendlyError(error));
          }
          return;
        }
        if (!(await sendMessage(thread.id, payload))) {
          setText(payload);
        }
      }}>
        {thread.kind !== 'AI' ? (
          <button
            type="button"
            className="composer__attach"
            aria-label="Вложение"
            title="Вложения временно отключены"
            onClick={() => {
              setToast('Вложения в чате временно отключены. Отправьте текстовое сообщение.');
            }}
          >
            +
          </button>
        ) : null}
        <Input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            const now = Date.now();
            if (now - lastTypingSentRef.current > 1200) {
              lastTypingSentRef.current = now;
              core.sendRealtimeTyping(thread.id);
            }
          }}
          maxLength={1000}
          placeholder={t('chat.messagePlaceholder')}
          aria-label={t('chat.messageAria')}
        />
        <Button type="submit" disabled={!text.trim()} busy={core.actionBusy === `message-${thread.id}`}>{t('chat.send')}</Button>
      </form>
      {typingLabel ? <p className="muted chat-typing">{typingLabel}</p> : null}
    </> : <StateView title={t('chat.chooseTitle')} text={t('chat.chooseText')} />}</div>
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
                await openOnixProfile(member.onixId);
              }}
            >
              <span className="thread-peer">
                <UserAvatar
                  avatarUrl={member.avatarUrl}
                  name={member.username}
                  online={sellerIsPresent(
                    { onixId: member.onixId, lastOnline: member.lastOnline },
                    core.profile,
                    core.presenceOf(member.onixId),
                  )}
                />
                <span>
                  <b>{publicAt(member.username)} <StaffBadge badge={member.badge} /></b>
                  <small>{formatOnixId(member.onixId)} · {formatLastSeen(core.presenceOf(member.onixId)?.lastOnline ?? member.lastOnline)}</small>
                </span>
              </span>
            </button>
          ))}
      </div>
    </Modal>
  </div>;
}
export default Chats;
