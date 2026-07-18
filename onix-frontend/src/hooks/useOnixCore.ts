import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, bootstrapAuth, friendlyError, getAccessToken, ApiError } from '../api/client';
import { getSharedAuthManager, probeAuthV2Session } from '../auth';
import {
  ensureTelegramMiniAppReady,
  isTelegramMiniApp,
  signalTelegramReadyIfMiniApp,
  telegramHaptic,
  logTelegramDetect,
} from '../auth/telegramEnv';
import { isTransientRefreshFailure } from '../auth/refreshClient';
import { API_PATHS, type AsyncState, type BanInfo, type BanReasonCode, type ChatThread, type Deal, type Message, type Notification, type OrderListQuery, type PlatformStatus, type Product, type ProductDraft, type ProductListQuery, type Profile, type Review } from '../api/contracts';
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
 * Website: public catalog first (never blocked by session).
 * Session cookie probe is the only restore gate — 401/guest never calls refresh.
 * Telegram SDK is not used on website bootstrap.
 */
async function restoreWebsiteSession(): Promise<AuthBootstrap> {
  const manager = getSharedAuthManager();
  if (manager.getAccessToken() && !manager.isAccessExpired()) {
    markBootstrapPhase('session-check', 0);
    markBootstrapPhase('cookie-check', 0);
    markBootstrapPhase('refresh', 0);
    markBootstrapPhase('telegram', 0);
    return { status: 'authenticated', mode: 'website' };
  }

  const probe = await bootstrapPhase('session-check', () => probeAuthV2Session());
  markBootstrapPhase('telegram', 0);

  if (probe.ok === false) {
    // Explicit: never POST /refresh after session 401/guest/network.
    markBootstrapPhase('refresh', 0);
    markBootstrapPhase('cookie-check', 0);
    if (probe.reason === 'network') return { status: 'network' };
    return { status: 'guest' };
  }

  markBootstrapPhase('cookie-check', 1);

  // Refresh only after successful session cookie probe (or explicit login elsewhere).
  try {
    await bootstrapPhase('refresh', () => manager.refreshAccessToken());
    if (manager.getAccessToken()) {
      return { status: 'authenticated', mode: 'website' };
    }
    markBootstrapPhase('refresh', 0);
    return { status: 'guest' };
  } catch (error) {
    if (isTransientRefreshFailure(error)) return { status: 'network' };
    return { status: 'guest' };
  }
}

async function ensureWebsiteOrMiniAuth(): Promise<AuthBootstrap> {
  if (isTelegramMiniApp()) {
    const miniOk = await bootstrapPhase('telegram', async () => {
      // Wait for initData (SDK may need to parse tgWebAppData) before /telegram-mini.
      await ensureTelegramMiniAppReady();
      return bootstrapAuth();
    });
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
    bootstrapPhase('products', () => load('products', API_PATHS.productsList({ limit: 10 }))),
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

  const load = useCallback(async <K extends CollectionKey>(key: K, path: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setStates(previous => ({ ...previous, [key]: 'loading' }));
    }
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

      // Website:
      // 1) render shell (already)
      // 2) load public products (first paint) + session-check in parallel
      // 3) session OK → profile/orders/chats; 401 → guest (market already visible)
      markBootstrapPhase('telegram', 0);
      setStates((previous) => ({
        ...previous,
        products: previous.products === 'success' ? previous.products : 'loading',
        profile: 'loading',
      }));

      const productsPromise = bootstrapPhase('products-public', () =>
        load('products', API_PATHS.productsList({ limit: 10 })),
      );
      const sessionPromise = restoreWebsiteSession();

      // Catalog readiness is independent of session (guest or user).
      const catalogReady = productsPromise.then(() => {
        markBootstrapPhase('marketplace', 0);
        markAppReady('marketplace-ready');
      });

      const boot = await sessionPromise;

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
        printBootstrapSummary('bootstrap-guest');
        markAppReady('bootstrap-settled');
        // Products continue in background — do not block guest on hung /api/products.
        void catalogReady;
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
        printBootstrapSummary('bootstrap-network');
        markAppReady('bootstrap-settled');
        void catalogReady;
        return;
      }

      // Session OK: profile loads without waiting for products (already in flight).
      void catalogReady;
      const current = await bootstrapPhase('profile-load', () => loadProfile());
      markBootstrapPhase('profile', 0);
      // Re-fetch catalog with Bearer so favorites/followed personalize (same public endpoint).
      void load('products', API_PATHS.productsList({ limit: 100 }));
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
    // Ordinary www: zero Telegram SDK / ready / expand (required for RU cookie path).
    // Mini App only: signal ready after real initData / tgWebAppData detection.
    if (isTelegramMiniApp()) {
      bootstrapPhaseSync('telegram', () => signalTelegramReadyIfMiniApp());
    } else {
      markBootstrapPhase('telegram', 0);
    }
    markAppReady('shell-mounted');
    if (coldBootstrapOnce) return;
    coldBootstrapOnce = true;
    bootstrapStart();
    logTelegramDetect('before refreshAll()');
    void refreshAll();
  }, [refreshAll]);

  // Keep lastSeenAt fresh while the shell is visible — profile only (no full catalog rewrite).
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    const beat = async () => {
      if (cancelled || document.hidden) return;
      try {
        const res = await api.post<{ lastOnline: string; online: boolean }>(API_PATHS.mePresence, {});
        if (cancelled || !res?.lastOnline) return;
        setProfile((prev) => (prev ? { ...prev, lastOnline: res.lastOnline } : prev));
      } catch {
        /* ignore — offline / guest */
      }
    };
    void beat();
    const id = window.setInterval(() => { void beat(); }, 90_000);
    const onVis = () => { if (!document.hidden) void beat(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [profile?.onixId]);

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

  const refreshChats = useCallback(async () => {
    await load('chats', API_PATHS.chats, { silent: true });
  }, [load]);

  const searchChats = useCallback(async (q: string) => {
    const trimmed = q.trim();
    await load('chats', trimmed ? API_PATHS.chatsSearch(trimmed) : API_PATHS.chats, { silent: true });
  }, [load]);

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

  const supportComplete = useCallback((dealId: string, reason?: string) => run(`complete-${dealId}`, () =>
    api.post(API_PATHS.supportComplete(dealId), { ...(reason ? { reason } : {}) }),
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

  const setUserStatus = useCallback((userId: string, status: PlatformStatus) =>
    run('admin-status', () => api.patch(API_PATHS.adminStatus(userId), { status })), [run]);

  // Badge: chat unread only (in-app notifications stay for API/history; UI tab removed).
  const unread = useMemo(() => store.chats.reduce((total, chat) => total + chat.unreadCount, 0), [store.chats]);

  return {
    profile, ...store, states, errors, messages, actionBusy, unread, banFromAuth,
    refreshAll, loadProfile, loadMessages, refreshChats, searchChats, listProducts, listFavorites, listDeals, createProduct, updateProduct, archiveProduct, toggleFavorite,
    toggleFollow, purchase, dealAction, openSupport, supportRefund, supportComplete, sellerRefund, startChat, sendMessage, withdraw, submitReview,
    markNotificationRead, adminAction, setUserStatus, reportUser,
  };
}
