import { useCallback, useEffect, useMemo, useState } from 'react';
import WebApp from '@twa-dev/sdk';
import { api, bootstrapAuth, friendlyError, getAccessToken } from '../api/client';
import {
  getAuthV2Me,
  getSharedAuthManager,
  resolveApiBase,
} from '../auth';
import { API_PATHS, type AsyncState, type BanReasonCode, type ChatThread, type Deal, type Message, type Notification, type OrderListQuery, type Product, type ProductDraft, type ProductListQuery, type Profile, type Review } from '../api/contracts';

type CollectionKey = 'products' | 'deals' | 'chats' | 'notifications' | 'reviews';
type AuthMode = 'mini' | 'website' | 'legacy';
type Store = {
  products: Product[];
  deals: Deal[];
  chats: ChatThread[];
  notifications: Notification[];
  reviews: Review[];
};

const emptyStore: Store = { products: [], deals: [], chats: [], notifications: [], reviews: [] };
const notify = (kind: 'success' | 'error') => {
  try { WebApp.HapticFeedback.notificationOccurred(kind); } catch { /* Browser client. */ }
};

/**
 * Mini App → AuthManager (bot / V2 refresh cookie) → legacy sessionStorage.
 * After Website session: one GET /api/v2/auth/me, then domain bootstrap uses the same APIs as Mini App.
 */
async function ensureWebsiteOrMiniAuth(): Promise<AuthMode | null> {
  const miniOk = await bootstrapAuth();
  if (miniOk) return 'mini';

  const manager = getSharedAuthManager();
  const hasMemory = Boolean(manager.getAccessToken() && !manager.isAccessExpired());
  const restored = hasMemory || await manager.restoreSession();
  if (restored && manager.getAccessToken()) {
    try {
      await getAuthV2Me(manager.getAccessToken()!, fetch, resolveApiBase());
      return 'website';
    } catch {
      manager.clearSession('refresh-failed');
    }
  }

  if (getAccessToken()) return 'legacy';
  return null;
}

/** Full marketplace bootstrap — same paths/DTOs as Mini App (ONIX DB via Backend only). */
async function bootstrapAuthenticatedUser(
  loadProfile: () => Promise<Profile | null>,
  load: <K extends CollectionKey>(key: K, path: string) => Promise<void>,
): Promise<void> {
  const current = await loadProfile();
  await Promise.all([
    load('products', API_PATHS.productsList({ limit: 100 })),
    load('deals', API_PATHS.orders),
    load('chats', API_PATHS.chats),
    load('notifications', API_PATHS.notifications),
    ...(current ? [load('reviews', API_PATHS.reviews(current.onixId))] : []),
  ]);
}

export function useOnixCore() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [store, setStore] = useState<Store>(emptyStore);
  const [states, setStates] = useState<Record<CollectionKey | 'profile', AsyncState>>({
    profile: 'loading', products: 'loading', deals: 'loading', chats: 'loading', notifications: 'loading', reviews: 'loading',
  });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const load = useCallback(async <K extends CollectionKey>(key: K, path: string) => {
    setStates(previous => ({ ...previous, [key]: 'loading' }));
    try {
      const data = await api.get<Store[K]>(path);
      setStore(previous => ({ ...previous, [key]: data }));
      setErrors(previous => ({ ...previous, [key]: undefined }));
      setStates(previous => ({ ...previous, [key]: 'success' }));
    } catch (error) {
      setErrors(previous => ({ ...previous, [key]: friendlyError(error) }));
      setStates(previous => ({ ...previous, [key]: 'error' }));
    }
  }, []);

  const loadProfile = useCallback(async () => {
    setStates(previous => ({ ...previous, profile: 'loading' }));
    try {
      const complete = await api.get<Profile>(API_PATHS.me);
      setProfile(complete);
      setErrors(previous => ({ ...previous, profile: undefined }));
      setStates(previous => ({ ...previous, profile: 'success' }));
      return complete;
    } catch (error) {
      setProfile(null);
      setErrors(previous => ({ ...previous, profile: friendlyError(error) }));
      setStates(previous => ({ ...previous, profile: 'error' }));
      return null;
    }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const mode = await ensureWebsiteOrMiniAuth();
      if (!mode) {
        setProfile(null);
        setStore(emptyStore);
        setStates(previous => ({
          ...previous,
          profile: 'error',
          products: 'idle',
          deals: 'idle',
          chats: 'idle',
          notifications: 'idle',
          reviews: 'idle',
        }));
        setErrors(previous => ({ ...previous, profile: 'Войдите через Telegram, чтобы продолжить.' }));
        return;
      }

      // Guest → Loading User → Authenticated (same bootstrap for Mini App, Website bot, legacy).
      await bootstrapAuthenticatedUser(loadProfile, load);
    } catch (error) {
      setProfile(null);
      setStates(previous => ({ ...previous, profile: 'error' }));
      setErrors(previous => ({ ...previous, profile: friendlyError(error) }));
    }
  }, [load, loadProfile]);

  useEffect(() => {
    try { WebApp.ready(); WebApp.expand(); } catch { /* Regular web. */ }
    void refreshAll();
  }, [refreshAll]);

  const run = useCallback(async <T,>(key: string, request: () => Promise<T>, after?: () => void): Promise<T | null> => {
    if (actionBusy) return null;
    setActionBusy(key);
    try {
      const result = await request();
      notify('success');
      after?.();
      return result;
    } catch (error) {
      notify('error');
      setErrors(previous => ({ ...previous, [key]: friendlyError(error) }));
      return null;
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy]);

  const cents = (rubles: string | number) => Math.round(Number(rubles) * 100).toString();

  const listProducts = useCallback((query: ProductListQuery = {}) =>
    api.get<Product[]>(API_PATHS.productsList(query)), []);

  const createProduct = useCallback((draft: ProductDraft) => run('product-form', () =>
    api.post<Product>(API_PATHS.productCreate, {
      title: draft.title.trim(),
      description: draft.description.trim(),
      priceCents: cents(draft.priceRubles),
      quantity: draft.quantity,
      category: draft.category,
      subcategory: draft.subcategory.trim() || undefined,
      autoDeliver: Boolean(draft.autoDeliver),
      ...(draft.autoDeliver && draft.deliveryText?.trim()
        ? { deliveryText: draft.deliveryText.trim() }
        : {}),
    }), () => void load('products', API_PATHS.productsList({ limit: 100 }))), [load, run]);

  const updateProduct = useCallback((id: string, draft: ProductDraft) => run('product-form', () =>
    api.patch<Product>(API_PATHS.productUpdate(id), {
      title: draft.title.trim(), description: draft.description.trim(), priceCents: cents(draft.priceRubles),
      quantity: draft.quantity, category: draft.category, subcategory: draft.subcategory.trim() || undefined,
      autoDeliver: Boolean(draft.autoDeliver),
      ...(draft.autoDeliver && draft.deliveryText?.trim()
        ? { deliveryText: draft.deliveryText.trim() }
        : {}),
    }), () => void load('products', API_PATHS.productsList({ limit: 100 }))), [load, run]);

  const archiveProduct = useCallback((id: string) => run(`archive-${id}`, () =>
    api.delete<Product>(API_PATHS.productDelete(id)),
  () => void load('products', API_PATHS.productsList({ limit: 100 }))), [load, run]);

  const toggleFavorite = useCallback((product: Product) => {
    setStore(previous => ({ ...previous, products: previous.products.map(item =>
      item.id === product.id ? { ...item, favorite: !item.favorite } : item) }));
    void run(`favorite-${product.id}`, () => product.favorite
      ? api.delete(API_PATHS.favorite(product.id))
      : api.post(API_PATHS.favorite(product.id)), () => void load('products', API_PATHS.productsList({ limit: 100 })));
  }, [load, run]);

  const toggleFollow = useCallback((onixId: string, followed = false) => {
    const delta = followed ? -1 : 1;
    setStore((previous) => ({
      ...previous,
      products: previous.products.map((item) => (
        item.seller.onixId === onixId
          ? {
            ...item,
            seller: {
              ...item.seller,
              followed: !followed,
              followersCount: Math.max(0, item.seller.followersCount + delta),
            },
          }
          : item
      )),
    }));
    return run(
      `follow-${onixId}`,
      () => (followed
        ? api.delete<{ onixId: string; followed: boolean; followersCount: number }>(API_PATHS.follow(onixId))
        : api.post<{ onixId: string; followed: boolean; followersCount: number }>(API_PATHS.follow(onixId))),
      () => {
        void load('products', API_PATHS.productsList({ limit: 100 }));
      },
    ).then((result) => {
      if (!result) {
        void load('products', API_PATHS.productsList({ limit: 100 }));
        return null;
      }
      setStore((previous) => ({
        ...previous,
        products: previous.products.map((item) => (
          item.seller.onixId === onixId
            ? {
              ...item,
              seller: {
                ...item.seller,
                followed: result.followed,
                followersCount: result.followersCount,
              },
            }
            : item
        )),
      }));
      return result;
    });
  }, [load, run]);

  const purchase = useCallback((productId: string) => run(`purchase-${productId}`, () =>
    api.post(API_PATHS.productPurchase(productId), { idempotencyKey: crypto.randomUUID(), quantity: 1 }), () => {
      void load('products', API_PATHS.productsList({ limit: 100 })); void load('deals', API_PATHS.orders);
    }), [load, run]);

  const dealAction = useCallback((deal: Deal, action: 'deliver' | 'complete' | 'dispute') => {
    const path = action === 'deliver' ? API_PATHS.dealDeliver(deal.id) : action === 'complete' ? API_PATHS.dealComplete(deal.id) : API_PATHS.dealDispute(deal.id);
    return run(`deal-${deal.id}`, () => api.post(path, {
      idempotencyKey: crypto.randomUUID(),
      ...(action === 'dispute' ? { reason: 'Открыто пользователем' } : {}),
    }), () => void load('deals', API_PATHS.orders));
  }, [load, run]);

  const loadMessages = useCallback(async (threadId: string) => {
    try {
      const data = await api.get<Message[]>(API_PATHS.messages(threadId));
      setMessages(previous => ({ ...previous, [threadId]: data }));
    } catch (error) {
      setErrors(previous => ({ ...previous, [`messages-${threadId}`]: friendlyError(error) }));
    }
  }, []);

  const sendMessage = useCallback(async (threadId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const result = await run(`message-${threadId}`, () => api.post<Message>(API_PATHS.messages(threadId), { text: trimmed }));
    if (result) {
      setMessages(previous => ({ ...previous, [threadId]: [...(previous[threadId] || []), result] }));
      return true;
    }
    return false;
  }, [run]);

  const startChat = useCallback((onixId: string) => run(`chat-${onixId}`, () =>
    api.post<ChatThread>(API_PATHS.directChat, { onixId }),
  () => void load('chats', API_PATHS.chats)), [load, run]);

  const openSupport = useCallback((dealId: string, reason?: string) => run(`support-${dealId}`, () =>
    api.post<{ ticketId: string; chatId: string }>(API_PATHS.orderSupport(dealId), {
      ...(reason ? { reason } : {}),
    }), () => {
      void load('chats', API_PATHS.chats);
      void load('deals', API_PATHS.orders);
    }), [load, run]);

  const supportRefund = useCallback((dealId: string, reason?: string) => run(`refund-${dealId}`, () =>
    api.post(API_PATHS.supportRefund(dealId), { ...(reason ? { reason } : {}) }),
  () => void load('deals', API_PATHS.orders)), [load, run]);

  const withdraw = useCallback((amountRubles: number) => run('withdraw', () =>
    api.post(API_PATHS.walletWithdraw, { amountCents: cents(amountRubles), idempotencyKey: crypto.randomUUID() }), loadProfile), [loadProfile, run]);

  const submitReview = useCallback((dealId: string, rating: number, text: string) => run('review', () =>
    api.post<Review>(API_PATHS.reviewCreate(dealId), { rating, text: text.trim() }), () => {
      if (profile) void load('reviews', API_PATHS.reviews(profile.onixId));
    }), [load, profile, run]);

  const markNotificationRead = useCallback(async (id: string) => {
    await api.patch(API_PATHS.notificationRead(id), {});
    setStore(previous => ({
      ...previous,
      notifications: previous.notifications.map((item) => item.id === id ? { ...item, read: true } : item),
    }));
  }, []);

  const listDeals = useCallback(async (query: OrderListQuery = {}) => {
    setStates(previous => ({ ...previous, deals: 'loading' }));
    try {
      const data = await api.get<Deal[]>(API_PATHS.ordersList(query));
      setStore(previous => ({ ...previous, deals: data }));
      setErrors(previous => ({ ...previous, deals: undefined }));
      setStates(previous => ({ ...previous, deals: 'success' }));
      return data;
    } catch (error) {
      setErrors(previous => ({ ...previous, deals: friendlyError(error) }));
      setStates(previous => ({ ...previous, deals: 'error' }));
      return null;
    }
  }, []);

  const sellerRefund = useCallback((dealId: string, reason: string) => run(`seller-refund-${dealId}`, () =>
    api.post(API_PATHS.orderRefundRequest(dealId), { reason, idempotencyKey: crypto.randomUUID() }),
  () => void load('deals', API_PATHS.orders)), [load, run]);

  const adminAction = useCallback((
    action: 'ban' | 'unban',
    userId: string,
    ban?: { reason: BanReasonCode; comment: string; durationDays?: number },
  ) => run(`admin-${action}`, () => {
    if (action === 'ban' && ban) {
      return api.patch(API_PATHS.adminBan(userId), {
        banned: true,
        reason: ban.reason,
        comment: ban.comment,
        ...(ban.durationDays ? { durationDays: ban.durationDays } : {}),
      });
    }
    return api.patch(API_PATHS.adminBan(userId), { banned: false });
  }), [run]);

  // Badge: chat unread only (in-app notifications stay for API/history; UI tab removed).
  const unread = useMemo(() => store.chats.reduce((total, chat) => total + chat.unreadCount, 0), [store.chats]);

  return {
    profile, ...store, states, errors, messages, actionBusy, unread,
    refreshAll, loadProfile, loadMessages, listProducts, listDeals, createProduct, updateProduct, archiveProduct, toggleFavorite,
    toggleFollow, purchase, dealAction, openSupport, supportRefund, sellerRefund, startChat, sendMessage, withdraw, submitReview,
    markNotificationRead, adminAction,
  };
}
