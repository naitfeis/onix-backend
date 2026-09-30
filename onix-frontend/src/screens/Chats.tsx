import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react';
import { api, friendlyError } from '../api/client';
import { API_PATHS, formatLastSeen, sellerIsPresent, type Product, type PublicProfile, type Seller } from '../api/contracts';
import UserAvatar from '../components/UserAvatar';
import { Button, Card, Input, Skeleton, StateView } from '../design-system';
import { formatOnixId } from '../utils/onixId';
import { publicAt } from '../utils/publicAt';
import type { Core } from './types';
import { MessageText, PublicProfileModal, ReportUserModal, StaffBadge } from './shared';
import { MoreActionsMenu } from '../components/MoreActionsMenu';
import { playSound, unlockSounds } from '../audio/sounds';
import { getRealtimeClient } from '../realtime/client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { t } from '../i18n';

const NEAR_BOTTOM_PX = 96;
/** Distance from the top that triggers loading an older page. */
const OLDER_TRIGGER_PX = 80;
const LONG_PRESS_MS = 480;
const CHAT_LIST_W_KEY = 'onix-chat-list-w';
const CHAT_LIST_DEFAULT = 320;
const CHAT_LIST_MIN = 220;

type ChatFilter = 'all' | 'direct' | 'orders' | 'favorites' | 'blacklist';

const CHAT_FILTERS: Array<{ id: ChatFilter; labelKey: 'chat.filterAll' | 'chat.filterDirect' | 'chat.filterOrders' | 'chat.filterFavorites' | 'chat.filterBlacklist' }> = [
  { id: 'all', labelKey: 'chat.filterAll' },
  { id: 'direct', labelKey: 'chat.filterDirect' },
  { id: 'orders', labelKey: 'chat.filterOrders' },
  { id: 'favorites', labelKey: 'chat.filterFavorites' },
  { id: 'blacklist', labelKey: 'chat.filterBlacklist' },
];

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
  const [peerProfile, setPeerProfile] = useState<PublicProfile | null>(null);
  const [reportOnixId, setReportOnixId] = useState<string | null>(null);
  const [menuMessageId, setMenuMessageId] = useState<string | null>(null);
  const [pendingNewCount, setPendingNewCount] = useState(0);
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [favoriteUsers, setFavoriteUsers] = useState<Seller[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<Seller[]>([]);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const lastSeenMsgIdRef = useRef<string | null>(null);
  /** Scroll state to restore after an older history page is prepended. */
  const olderAnchorRef = useRef<{ anchorId: string; prevScrollHeight: number; prevScrollTop: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const visibleChats = useMemo(
    () => core.chats.filter((chat) => chat.kind !== 'GROUP'),
    [core.chats],
  );
  const favoriteIds = useMemo(
    () => new Set(favoriteUsers.map((u) => u.onixId)),
    [favoriteUsers],
  );
  const blockedIds = useMemo(
    () => new Set(blockedUsers.map((u) => u.onixId)),
    [blockedUsers],
  );
  const totalUnread = useMemo(
    () => visibleChats.reduce((sum, chat) => {
      if (chat.peerOnixId && blockedIds.has(chat.peerOnixId)) return sum;
      return sum + (chat.unreadCount > 0 ? chat.unreadCount : 0);
    }, 0),
    [visibleChats, blockedIds],
  );
  const filteredChats = useMemo(() => {
    const notBlocked = (chat: (typeof visibleChats)[number]) => (
      !chat.peerOnixId || !blockedIds.has(chat.peerOnixId)
    );
    switch (filter) {
      case 'direct':
        return visibleChats.filter((chat) => (
          notBlocked(chat)
          && chat.kind !== 'AI'
          && (chat.kind === 'DIRECT' || chat.kind == null)
          && !chat.dealId
          && !chat.orderCard
        ));
      case 'orders':
        return visibleChats.filter((chat) => (
          notBlocked(chat)
          && chat.kind !== 'AI'
          && Boolean(chat.dealId || chat.orderCard)
        ));
      case 'favorites':
        return visibleChats.filter((chat) => (
          Boolean(chat.peerOnixId && favoriteIds.has(chat.peerOnixId))
        ));
      case 'blacklist':
        return [];
      case 'all':
      default:
        return visibleChats.filter(notBlocked);
    }
  }, [filter, visibleChats, favoriteIds, blockedIds]);
  const chatPeerIds = useMemo(
    () => new Set(visibleChats.map((chat) => chat.peerOnixId).filter(Boolean) as string[]),
    [visibleChats],
  );
  const favoriteWithoutChat = useMemo(
    () => favoriteUsers.filter((user) => !chatPeerIds.has(user.onixId)),
    [favoriteUsers, chatPeerIds],
  );
  const thread = visibleChats.find(item => item.id === threadId);
  // useMemo (not a per-render conditional array) so the dedupe memo below has
  // a stable dependency identity.
  const threadMessages = core.messages;
  const rawMessages = useMemo(
    () => (threadId ? threadMessages[threadId] || [] : []),
    [threadId, threadMessages],
  );
  /**
   * Render history deduplicated by real message id only.
   *
   * A fuzzy "same text within 4s" rule used to drop legitimate repeats (two
   * quick «да» in a deal chat), and a deal confirmation can be evidence in a
   * dispute. Optimistic echo collapsing stays in appendUniqueMessage, where it
   * belongs — that path knows which row is the client's own placeholder.
   */
  const messages = useMemo(() => {
    const seenIds = new Set<string>();
    const out: typeof rawMessages = [];
    for (const row of rawMessages) {
      const id = String(row.id);
      if (!id || seenIds.has(id)) continue;
      if (row.kind !== 'SYSTEM' && !row.text?.trim() && !row.attachment) continue;
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
  // Destructured (not `core.x`) so effects can list stable identities in deps:
  // referencing `core.listFavoriteUsers` inside a body but omitting `core`
  // itself is exactly the stale-closure shape exhaustive-deps guards against.
  const {
    loadMessages, refreshChats, sendMessage,
    subscribeRealtimeChat, unsubscribeRealtimeChat,
    listFavoriteUsers, listBlockedUsers, setActiveChatId,
    sendRealtimeTyping,
    messagesHasOlder, messagesOlderLoading, notifications,
    // Renamed: the local scroll handler below owns the name loadOlderMessages.
    loadOlderMessages: fetchOlderMessages,
  } = core;
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
        if (chat.id) subscribeRealtimeChat(chat.id);
        void refreshChats();
      })
      .catch(() => { /* AI optional */ });
  }, [refreshChats, subscribeRealtimeChat]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listFavoriteUsers(), listBlockedUsers()])
      .then(([favs, blocks]) => {
        if (!cancelled) {
          setFavoriteUsers(favs);
          setBlockedUsers(blocks);
        }
      })
      .catch(() => { /* optional social lists */ });
    return () => { cancelled = true; };
  }, [listFavoriteUsers, listBlockedUsers]);

  useEffect(() => {
    if (filter !== 'favorites' && filter !== 'blacklist') return;
    let cancelled = false;
    void Promise.all([listFavoriteUsers(), listBlockedUsers()])
      .then(([favs, blocks]) => {
        if (!cancelled) {
          setFavoriteUsers(favs);
          setBlockedUsers(blocks);
        }
      })
      .catch(() => { /* optional social lists */ });
    return () => { cancelled = true; };
  }, [filter, listFavoriteUsers, listBlockedUsers]);

  useEffect(() => {
    if (threadId) void loadMessages(threadId);
  }, [loadMessages, threadId]);

  useEffect(() => {
    if (!active) {
      setActiveChatId(null);
      return;
    }
    setActiveChatId(threadId || null);
    return () => setActiveChatId(null);
  }, [active, threadId, setActiveChatId]);

  useEffect(() => {
    if (!active || !threadId) return;
    setActiveChatId(threadId);
  }, [active, threadId, notifications, setActiveChatId]);

  useEffect(() => {
    if (!active || !threadId) return;
    subscribeRealtimeChat(threadId);
    return () => unsubscribeRealtimeChat(threadId);
  }, [active, threadId, subscribeRealtimeChat, unsubscribeRealtimeChat]);

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
    const focused = core.chats.find((c) => c.id === focusChatId);
    if (focused?.kind === 'GROUP') {
      onFocusChatHandled();
      return;
    }
    setThreadId(focusChatId);
    onFocusChatHandled();
  }, [focusChatId, onFocusChatHandled, core.chats]);

  useEffect(() => {
    if (threadId && !visibleChats.some((c) => c.id === threadId)) {
      setThreadId('');
    }
  }, [threadId, visibleChats]);

  useEffect(() => {
    stickToBottomRef.current = true;
    lastSeenMsgIdRef.current = null;
    setPendingNewCount(0);
    setMenuMessageId(null);
  }, [threadId]);

  // Extracted so the deps array stays statically checkable.
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  const lastMessageIndex = messages.length - 1;
  useEffect(() => {
    const el = messagesRef.current;
    if (!el || !threadId) return;
    const lastId = lastMessageId;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      if (lastId) {
        requestAnimationFrame(() => messageVirtualizer.scrollToIndex(lastMessageIndex, { align: 'end' }));
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
  }, [threadId, messages, lastMessageId, lastMessageIndex, messageVirtualizer]);

  useEffect(() => () => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
  }, []);

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

  /**
   * Prepend an older history page and keep the viewport anchored on the message
   * that was previously at the top.
   *
   * Compensation runs in a layout effect after React commits the new rows —
   * reading scrollHeight right after the await would measure the pre-update DOM.
   * `lastSeenMsgIdRef` is kept on the newest message so the growth is not
   * misread as "N new messages" (that counter is for live incoming traffic).
   */
  const loadOlderMessages = async () => {
    if (!threadId) return;
    if (!messagesHasOlder[threadId]) return;
    if (messagesOlderLoading[threadId]) return;
    const el = messagesRef.current;
    if (!el) return;
    const anchorId = messages[0]?.id ?? null;
    if (!anchorId) return;
    olderAnchorRef.current = {
      anchorId,
      prevScrollHeight: el.scrollHeight,
      prevScrollTop: el.scrollTop,
    };
    // Reading history, not live messages.
    stickToBottomRef.current = false;
    lastSeenMsgIdRef.current = messages[messages.length - 1]?.id ?? null;
    await fetchOlderMessages(threadId);
  };

  useLayoutEffect(() => {
    const anchor = olderAnchorRef.current;
    if (!anchor) return;
    olderAnchorRef.current = null;
    const el = messagesRef.current;
    if (!el) return;
    const index = messages.findIndex((row) => row.id === anchor.anchorId);
    if (index < 0) return;
    const offset = el.scrollHeight - anchor.prevScrollHeight;
    el.scrollTop = offset > 0 ? anchor.prevScrollTop + offset : anchor.prevScrollTop;
    // Virtualizer needs its internal offset synced with the container.
    requestAnimationFrame(() => messageVirtualizer.scrollToIndex(index, { align: 'start' }));
  }, [messages, messageVirtualizer]);

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

  if (core.states.chats === 'loading' && core.chats.length === 0) {
    return <Card><Skeleton lines={6} /></Card>;
  }

  return <div
    className="chat-layout"
    style={{ '--chat-list-w': `${listW}px` } as CSSProperties}
  >
    <div className={`thread-list ${thread ? 'mobile-hidden' : ''}`}>
      <div className="chat-filters game-page__subs" role="tablist" aria-label={t('chat.filtersAria')}>
        {CHAT_FILTERS.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={`game-page__sub${filter === id ? ' is-active' : ''}`}
            onClick={() => setFilter(id)}
          >
            <span className="game-page__sub-label">{t(labelKey)}</span>
            {id === 'all' && totalUnread > 0 && (
              <span className="game-page__sub-share" aria-hidden="true">
                <span className="game-page__sub-share-num">{totalUnread > 99 ? '99+' : totalUnread}</span>
              </span>
            )}
          </button>
        ))}
      </div>
      {core.states.chats === 'error' ? (
        <StateView title="Чаты недоступны" text={core.errors.chats || ''} />
      ) : filter === 'blacklist' ? (
        blockedUsers.length === 0 ? (
          <StateView title={t('chat.emptyBlacklist')} text="" />
        ) : (
          blockedUsers.map((user) => (
            <div className="thread" key={user.onixId}>
              <button
                type="button"
                className="thread-peer-hit"
                onClick={() => void openOnixProfile(user.onixId)}
              >
                <span className="thread-peer">
                  <UserAvatar
                    userId={user.id}
                    avatarUrl={user.avatarUrl}
                    name={user.username}
                    online={sellerIsPresent(user, core.profile, core.presenceOf(user.onixId))}
                  />
                  <span>
                    <b title={user.username}>{publicAt(user.username)} <StaffBadge badge={user.badge} /></b>
                    <small>{formatOnixId(user.onixId)}</small>
                  </span>
                </span>
              </button>
              <Button
                variant="ghost"
                busy={core.isBusy(`user-block-${user.onixId}`)}
                onClick={() => {
                  void (async () => {
                    const result = await core.toggleUserBlock(user.onixId, true);
                    if (!result) return;
                    setBlockedUsers((prev) => prev.filter((item) => item.onixId !== user.onixId));
                    setToast(t('social.unblock'));
                  })();
                }}
              >{t('social.unblock')}</Button>
            </div>
          ))
        )
      ) : filter === 'favorites' ? (
        filteredChats.length === 0 && favoriteWithoutChat.length === 0 ? (
          <StateView title={t('chat.emptyFavorites')} text="" />
        ) : (
          <>
            {filteredChats.map((chat) => (
              <button
                className={`thread${threadId === chat.id ? ' active' : ''}`}
                key={chat.id}
                type="button"
                onClick={() => setThreadId(chat.id)}
              >
                <span className="thread-peer">
                  <UserAvatar
                    userId={chat.peerUserId}
                    avatarUrl={chat.peerAvatarUrl}
                    name={chat.title}
                    online={!chat.peerOnixId
                      ? undefined
                      : sellerIsPresent(
                        { onixId: chat.peerOnixId, lastOnline: chat.peerLastOnline },
                        core.profile,
                        core.presenceOf(chat.peerOnixId),
                      )}
                  />
                  <span>
                    <b title={chat.title}>{chat.title} <StaffBadge badge={chat.peerBadge} /></b>
                    <small>{chat.subtitle || 'Открыть диалог'}</small>
                  </span>
                </span>
                {chat.unreadCount > 0 && <em>{chat.unreadCount}</em>}
              </button>
            ))}
            {favoriteWithoutChat.map((user) => (
              <div className="thread" key={`fav-${user.onixId}`}>
                <button
                  type="button"
                  className="thread-peer-hit"
                  onClick={() => void openOnixProfile(user.onixId)}
                >
                  <span className="thread-peer">
                    <UserAvatar
                      userId={user.id}
                      avatarUrl={user.avatarUrl}
                      name={user.username}
                      online={sellerIsPresent(user, core.profile, core.presenceOf(user.onixId))}
                    />
                    <span>
                      <b title={user.username}>{publicAt(user.username)} <StaffBadge badge={user.badge} /></b>
                      <small>{formatOnixId(user.onixId)}</small>
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  busy={core.isBusy(`chat-${user.onixId}`)}
                  onClick={() => { void openDirectChat(user.onixId); }}
                >Написать</Button>
              </div>
            ))}
          </>
        )
      ) : visibleChats.length === 0 ? (
        <StateView title={t('chat.emptyTitle')} text={t('chat.emptyText')} />
      ) : filteredChats.length === 0 ? (
        <StateView title={t('chat.emptyTitle')} text={t('chat.emptyText')} />
      ) : (
        filteredChats.map((chat) => (
          <button
            className={`thread${threadId === chat.id ? ' active' : ''}`}
            key={chat.id}
            type="button"
            onClick={() => setThreadId(chat.id)}
          >
            <span className="thread-peer">
              <UserAvatar
                userId={chat.kind === 'AI' ? undefined : chat.peerUserId}
                avatarUrl={chat.kind === 'AI' ? undefined : chat.peerAvatarUrl}
                name={chat.kind === 'AI' ? 'Onix AI' : chat.title}
                initials={chat.kind === 'AI' ? 'AI' : undefined}
                online={chat.kind === 'AI' || !chat.peerOnixId
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
                  {chat.kind === 'AI' ? (chat.subtitle || 'Помощник') : (chat.subtitle || 'Открыть диалог')}
                </small>
              </span>
            </span>
            {chat.unreadCount > 0 && <em>{chat.unreadCount}</em>}
          </button>
        ))
      )}
    </div>
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
        disabled={!thread.peerOnixId}
        aria-label={thread.peerOnixId ? `Профиль ${thread.title}` : undefined}
        onClick={async () => {
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
            online={thread.kind === 'AI' || !thread.peerOnixId
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
            {thread.kind === 'AI'
              ? 'Помощник'
              : `${thread.peerOnixId ? `${formatOnixId(thread.peerOnixId)} · ` : ''}${formatLastSeen(core.presenceOf(thread.peerOnixId ?? '')?.lastOnline ?? thread.peerLastOnline)}`}
          </small>
        </div>
      </button>
      {thread.peerOnixId && core.profile?.onixId !== thread.peerOnixId && (
        <MoreActionsMenu
          className="conversation__more"
          items={[
            {
              id: 'favorite',
              label: favoriteIds.has(thread.peerOnixId) ? t('social.favoriteRemove') : t('social.favoriteAdd'),
              disabled: core.isBusy(`user-favorite-${thread.peerOnixId}`),
              onSelect: () => {
                const peerId = thread.peerOnixId!;
                const wasFavorited = favoriteIds.has(peerId);
                void (async () => {
                  const result = await core.toggleUserFavorite(peerId, wasFavorited);
                  if (!result) return;
                  if (wasFavorited) {
                    setFavoriteUsers((prev) => prev.filter((item) => item.onixId !== peerId));
                  } else {
                    try {
                      setFavoriteUsers(await listFavoriteUsers());
                    } catch { /* keep optimistic */ }
                  }
                })();
              },
            },
            {
              id: 'block',
              label: blockedIds.has(thread.peerOnixId) ? t('social.unblock') : t('social.block'),
              disabled: core.isBusy(`user-block-${thread.peerOnixId}`),
              onSelect: () => {
                const peerId = thread.peerOnixId!;
                const wasBlocked = blockedIds.has(peerId);
                void (async () => {
                  const result = await core.toggleUserBlock(peerId, wasBlocked);
                  if (!result) return;
                  if (wasBlocked) {
                    setBlockedUsers((prev) => prev.filter((item) => item.onixId !== peerId));
                  } else {
                    setFavoriteUsers((prev) => prev.filter((item) => item.onixId !== peerId));
                    try {
                      setBlockedUsers(await listBlockedUsers());
                    } catch { /* keep local */ }
                    setToast(t('social.block'));
                  }
                })();
              },
            },
            {
              id: 'report',
              label: 'Пожаловаться',
              danger: true,
              onSelect: () => setReportOnixId(thread.peerOnixId!),
            },
          ]}
        />
      )}
      </div>
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
          // Load the previous page when the user reaches the top of history.
          if (el.scrollTop <= OLDER_TRIGGER_PX) void loadOlderMessages();
        }}
        onClick={() => setMenuMessageId(null)}
      >{messages.length === 0 ? <StateView title="Начните разговор" text="Сообщения сделки хранятся внутри ONIX." /> :
        <div className="messages__virtual-list" style={{ height: messageVirtualizer.getTotalSize(), position: 'relative' }}>
        {messageVirtualizer.getVirtualItems().map((virtualRow) => {
          const message = messages[virtualRow.index]!;
          return <div
            className="messages__virtual-row"
            key={message.id}
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
              sendRealtimeTyping(thread.id);
            }
          }}
          maxLength={1000}
          placeholder={t('chat.messagePlaceholder')}
          aria-label={t('chat.messageAria')}
        />
        <Button type="submit" disabled={!text.trim()} busy={core.isBusy(`message-${thread.id}`)}>{t('chat.send')}</Button>
      </form>
      {typingLabel ? <p className="muted chat-typing">{typingLabel}</p> : null}
    </> : <StateView title={t('chat.chooseTitle')} text={t('chat.chooseText')} />}</div>
    <PublicProfileModal
      profile={peerProfile}
      onClose={() => {
        setPeerProfile(null);
        void Promise.all([listFavoriteUsers(), listBlockedUsers()])
          .then(([favs, blocks]) => {
            setFavoriteUsers(favs);
            setBlockedUsers(blocks);
          })
          .catch(() => { /* ignore */ });
      }}
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
