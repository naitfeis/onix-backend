import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, bootstrapAuth, friendlyError, getAccessToken, ApiError } from '../api/client';
import { getSharedAuthManager, getAuthV2Session, AuthV2ApiError } from '../auth';
import { isTelegramMiniApp, signalTelegramReadyIfMiniApp, telegramHaptic } from '../auth/telegramEnv';
import { isTransientRefreshFailure } from '../auth/refreshClient';
import { API_PATHS, type AsyncState, type BanInfo, type BanReasonCode, type ChatThread, type Deal, type Message, type Notification, type OrderListQuery, type Product, type ProductDraft, type ProductListQuery, type Profile, type Review } from '../api/contracts';
import {
  bootstrapPhase,
  bootstrapPhaseSync,
  bootstrapStart,
  markBootstrapPhase,
  printBootstrapSummary,
} from '../perf/bootstrapTiming';
import { markAppReady } from '../perf/timing';

type CollectionKey = 'products' | 'deals' | 'chats' | 'notifications' | 'reviews';
type AuthMode = 'mini' | 'website' | 'legacy';
type AuthBootstrap =
  | { status: 'authenticated'; mode: AuthMode }
  | { status: 'guest' }
  | { status: 'network' };
type Store = {
  products: Product[];
  deals: Deal[];
  chats: ChatThread[];
  notifications: Notification[];
  reviews: Review[];
};

const emptyStore: Store = { products: [], deals: [], chats: [], notifications: [], reviews: [] };
/** Module-level — survives React StrictMode remount (useRef would reset). */
let coldBootstrapOnce = false;
const notify = (kind: 'success' | 'error') => {
  telegramHaptic(kind);
};

/**
 * Mini App and Website share the same ONIX database/users — different auth entrypoints.
 *
 * Mini App: Telegram initData → auto-login.
 * Website:  GET /api/v2/auth/session → 401 guest immediately (NO refresh);
 *           200 → then POST refresh for access token only.
 * Telegram never used for website restore.
 */
async function restoreWebsiteSession(): Promise<AuthBootstrap> {
  const manager = getSharedAuthManager();
  if (manager.getAccessToken() && !manager.isAccessExpired()) {
    markBootstrapPhase('auth-session', 0);
    markBootstrapPhase('cookie-check', 0);
    markBootstrapPhase('telegram', 0);
    return { status: 'authenticated', mode: 'website' };
  }

  // 1) Fast cookie probe — on 401 NEVER call refresh (that was the 12s hang).
  try {
    await bootstrapPhase('auth-session', () => getAuthV2Session());
    markBootstrapPhase('cookie-check', 1);
  } catch (error) {
    markBootstrapPhase('telegram', 0);
    markBootstrapPhase('cookie-check', 0);
    // Explicit: no refresh after session 401/403.
    if (error instanceof AuthV2ApiError && (error.status === 401 || error.status === 403)) {
      return { status: 'guest' };
    }
    if (isTransientRefreshFailure(error)) {
      return { status: 'network' };
    }
    return { status: 'guest' };
  }

  // 2) Session 200 only → mint access via refresh.
  try {
    await bootstrapPhase('refresh', () => manager.refreshAccessToken());
    markBootstrapPhase('telegram', 0);
    if (manager.getAccessToken()) {
      return { status: 'authenticated', mode: 'website' };
    }
    return { status: 'guest' };
  } catch (error) {
    markBootstrapPhase('telegram', 0);
    if (isTransientRefreshFailure(error)) return { status: 'network' };
    return { status: 'guest' };
  }
}

async function ensureWebsiteOrMiniAuth(): Promise<AuthBootstrap> {
  if (isTelegramMiniApp()) {
    const miniOk = await bootstrapPhase('telegram', () => bootstrapAuth());
    if (miniOk) return { status: 'authenticated', mode: 'mini' };
    if (getAccessToken()) return { status: 'authenticated', mode: 'legacy' };
    return { status: 'guest' };
  }

  return restoreWebsiteSession();
}

/**
 * Critical path only: profile + products (marketplace).
 * Orders/chats/reviews start after first market render — never block bootstrap-settled.
 */
async function bootstrapMarketplace(
  loadProfile: () => Promise<Profile | null>,
  load: <K extends CollectionKey>(key: K, path: string) => Promise<void>,
): Promise<Profile | null> {
  const [profileResult] = await Promise.all([
    bootstrapPhase('me', () => loadProfile()),
    bootstrapPhase('products', () => load('products', API_PATHS.productsList({ limit: 100 }))),
  ]);
  markBootstrapPhase('profile', 0);
  markBootstrapPhase('marketplace', 0);
  return profileResult;
}

function warmSecondaryCollections(
  profile: Profile | null,
  load: <K extends CollectionKey>(key: K, path: string) => Promise<void>,
): void {
  void bootstrapPhase('orders', () => load('deals', API_PATHS.orders));
  void bootstrapPhase('chats', () => load('chats', API_PATHS.chats));
  if (profile) {
    void load('reviews', API_PATHS.reviews(profile.onixId));
  }
}

export function useOnixCore() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [store, setStore] = useState<Store>(emptyStore);
  const [states, setStates] = useState<Record<CollectionKey | 'profile', AsyncState>>({
    profile: 'loading', products: 'idle', deals: 'idle', chats: 'idle', notifications: 'idle', reviews: 'idle',
  });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [banFromAuth, setBanFromAuth] = useState<BanInfo | undefined>();

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
      setBanFromAuth(undefined);

      // Mini App: Telegram auto-login, then market (unchanged).
      if (isTelegramMiniApp()) {
        const boot = await ensureWebsiteOrMiniAuth();
        if (boot.status !== 'authenticated') {
          setProfile(null);
          setStore(emptyStore);
          setStates((previous) => ({
            ...previous,
            profile: 'error',
            products: 'idle',
            deals: 'idle',
            chats: 'idle',
            notifications: 'idle',
            reviews: 'idle',
          }));
          setErrors((previous) => ({
            ...previous,
            profile: 'Войдите через Telegram, чтобы продолжить.',
          }));
          printBootstrapSummary('bootstrap-guest');
          markAppReady('bootstrap-settled');
          return;
        }
        setStates((previous) => ({
          ...previous,
          products: previous.products === 'success' ? previous.products : 'loading',
        }));
        const current = await bootstrapMarketplace(loadProfile, load);
        markAppReady('marketplace-ready');
        printBootstrapSummary('bootstrap-settled');
        markAppReady('bootstrap-settled');
        warmSecondaryCollections(current, load);
        setStates((previous) => ({ ...previous, notifications: 'idle' }));
        return;
      }

      // Website: session probe + products start together.
      // Guest settle MUST NOT await products (products can hang ~40s without VPN).
      markBootstrapPhase('telegram', 0);
      setStates((previous) => ({
        ...previous,
        products: previous.products === 'success' ? previous.products : 'loading',
        profile: 'loading',
      }));

      const productsPromise = bootstrapPhase('products', () =>
        load('products', API_PATHS.productsList({ limit: 100 })),
      );
      const boot = await restoreWebsiteSession();

      if (boot.status === 'guest') {
        setProfile(null);
        setStates((previous) => ({
          ...previous,
          profile: 'error',
          deals: 'idle',
          chats: 'idle',
          notifications: 'idle',
          reviews: 'idle',
        }));
        setErrors((previous) => ({
          ...previous,
          profile: 'Войдите через Telegram, чтобы продолжить.',
        }));
        markBootstrapPhase('marketplace', 0);
        printBootstrapSummary('bootstrap-guest');
        markAppReady('marketplace-ready');
        markAppReady('bootstrap-settled');
        // Products continue in background — do not block guest bootstrap.
        void productsPromise;
        return;
      }

      if (boot.status === 'network') {
        setProfile(null);
        setStates((previous) => ({
          ...previous,
          profile: 'error',
          deals: 'idle',
          chats: 'idle',
          notifications: 'idle',
          reviews: 'idle',
        }));
        setErrors((previous) => ({
          ...previous,
          profile: 'Нет связи с сервером. Сессия ONIX сохранена — обновите страницу.',
        }));
        markBootstrapPhase('marketplace', 0);
        printBootstrapSummary('bootstrap-network');
        markAppReady('marketplace-ready');
        markAppReady('bootstrap-settled');
        void productsPromise;
        return;
      }

      await productsPromise;
      const current = await bootstrapPhase('me', () => loadProfile());
      markBootstrapPhase('profile', 0);
      markBootstrapPhase('marketplace', 0);
      markAppReady('marketplace-ready');
      printBootstrapSummary('bootstrap-settled');
      markAppReady('bootstrap-settled');
      warmSecondaryCollections(current, load);
      setStates((previous) => ({ ...previous, notifications: 'idle' }));
    } catch (error) {
      setProfile(null);
      setStates(previous => ({ ...previous, profile: 'error' }));
      if (error instanceof ApiError && error.code === 'AUTH_ACCOUNT_LOCKED') {
        const ban = (error.details as { ban?: BanInfo } | undefined)?.ban;
        if (ban) setBanFromAuth(ban);
      }
      setErrors(previous => ({ ...previous, profile: friendlyError(error) }));
      printBootstrapSummary('bootstrap-error');
      markAppReady('bootstrap-settled');
    }
  }, [load, loadProfile]);

  useEffect(() => {
    // Mini App only — never blocks ordinary www bootstrap.
    bootstrapPhaseSync('telegram', () => signalTelegramReadyIfMiniApp());
    markAppReady('shell-mounted');
    if (coldBootstrapOnce) return;
    coldBootstrapOnce = true;
    bootstrapStart();
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

  const listProducts = useCallback((query: ProductListQuery = {}, signal?: AbortSignal) =>
    api.get<Product[]>(API_PATHS.productsList(query), signal), []);

  const listFavorites = useCallback(() =>
    api.get<Product[]>(API_PATHS.favorites), []);

  const reportUser = useCallback((onixId: string, reason: BanReasonCode, comment: string) =>
    run(`report-${onixId}`, () =>
      api.post(API_PATHS.userReport(onixId), { reason, comment })), []);

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
      : api.post(API_PATHS.favorite(product.id)), () => {
      // Optimistic UI already applied — no full products?limit=100 refetch.
    }).then((ok) => {
      if (ok === null) {
        // Revert on failure.
        setStore((previous) => ({
          ...previous,
          products: previous.products.map((item) => (
            item.id === product.id ? { ...item, favorite: product.favorite } : item
          )),
        }));
      }
    });
  }, [run]);

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
    ).then((result) => {
      if (!result) {
        // Revert optimistic patch — avoid refetching 100 products.
        setStore((previous) => ({
          ...previous,
          products: previous.products.map((item) => (
            item.seller.onixId === onixId
              ? {
                ...item,
                seller: {
                  ...item.seller,
                  followed,
                  followersCount: Math.max(0, item.seller.followersCount - delta),
                },
              }
              : item
          )),
        }));
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
  }, [run]);

  const purchase = useCallback((productId: string) => run(`purchase-${productId}`, () =>
    api.post<Deal>(API_PATHS.productPurchase(productId), { idempotencyKey: crypto.randomUUID(), quantity: 1 }), () => {
      // Sold-out listing: refresh market; deals/chats needed for Escrow + SYSTEM message.
      void load('products', API_PATHS.productsList({ limit: 100 }));
      void load('deals', API_PATHS.orders);
      void load('chats', API_PATHS.chats);
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
  ).then((thread) => {
    if (thread) {
      setStore((previous) => {
        const exists = previous.chats.some((chat) => chat.id === thread.id);
        return exists
          ? previous
          : { ...previous, chats: [thread, ...previous.chats] };
      });
      // Thread already in store — skip full chats list refetch on open.
    }
    return thread;
  }), [run]);

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
    profile, ...store, states, errors, messages, actionBusy, unread, banFromAuth,
    refreshAll, loadProfile, loadMessages, listProducts, listFavorites, listDeals, createProduct, updateProduct, archiveProduct, toggleFavorite,
    toggleFollow, purchase, dealAction, openSupport, supportRefund, sellerRefund, startChat, sendMessage, withdraw, submitReview,
    markNotificationRead, adminAction, reportUser,
  };
}
