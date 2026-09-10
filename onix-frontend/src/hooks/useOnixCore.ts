import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { api, bootstrapAuth, friendlyError, getAccessToken, clearAccessToken, ApiError } from '../api/client';
import {
  consumeGoogleOAuthIntent,
  consumeGoogleOAuthRedirect,
  confirmWebsiteLoginFromMiniAppIfNeeded,
  getSharedAuthManager,
  postAuthV2Google,
  postAuthV2LinkGoogle,
  postAuthV2Logout,
  readJwtSub,
} from '../auth';
import {
  ensureTelegramMiniAppReady,
  isTelegramMiniApp,
  signalTelegramReadyIfMiniApp,
  telegramHaptic,
  waitForTelegramMiniAppSurface,
} from '../auth/telegramEnv';
import { isTransientRefreshFailure } from '../auth/refreshClient';
import { API_PATHS, SUBCATEGORIES_BY_CATEGORY, normOnixId, type AsyncState, type BanInfo, type BanReasonCode, type ChatThread, type Deal, type Message, type Notification, type OrderListQuery, type Product, type ProductDraft, type ProductListQuery, type Profile, type Review, type SubcategoryCatalog } from '../api/contracts';
import {
  bootstrapPhase,
  bootstrapPhaseSync,
  bootstrapStart,
  markBootstrapPhase,
  printBootstrapSummary,
} from '../perf/bootstrapTiming';
import { markAppReady } from '../perf/timing';
import { getRealtimeClient } from '../realtime/client';
import { isOrderNotification, playSound } from '../audio/sounds';
import {
  hideCatalogProduct,
  isCatalogHidden,
  showCatalogProduct,
  visibleProducts,
} from '../catalogVisibility';
import { rublesToCentsString } from '../utils/moneyCents';
type CollectionKey = 'products' | 'deals' | 'chats' | 'notifications' | 'reviews';
type AuthMode = 'mini' | 'website' | 'legacy';
type AuthBootstrap =
  | { status: 'authenticated'; mode: AuthMode }
  | { status: 'guest' }
  | { status: 'network' };
type SessionRestore = 'pending' | 'guest' | 'authenticated' | 'network';
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

function messageKey(id: unknown): string {
  return String(id ?? '');
}

function appendUniqueMessage(list: Message[], incoming: Message): Message[] {
  const incomingId = messageKey(incoming.id);
  if (!incomingId) return list;
  const normalized = { ...incoming, id: incomingId };
  const idx = list.findIndex((row) => messageKey(row.id) === incomingId);
  if (idx === -1) {
    const echo = list.findIndex((row) => (
      row.mine === normalized.mine
      && row.sender.id === normalized.sender.id
      && (row.text || '') === (normalized.text || '')
      && Math.abs(new Date(row.createdAt).getTime() - new Date(normalized.createdAt).getTime()) < 4000
    ));
    if (echo >= 0) {
      const copy = list.slice();
      copy[echo] = { ...list[echo]!, ...normalized, id: messageKey(list[echo]!.id) };
      return copy;
    }
    return [...list, normalized];
  }
  const prev = list[idx]!;
  const nextText = normalized.text?.trim() ? normalized.text : prev.text;
  const nextReadBy = (normalized.readBy?.length ?? 0) > (prev.readBy?.length ?? 0) ? normalized.readBy : prev.readBy;
  const nextStatus = normalized.deliveryStatus === 'READ' || prev.deliveryStatus === 'READ'
    ? 'READ' as const
    : (normalized.deliveryStatus ?? prev.deliveryStatus);
  if (nextText === prev.text && nextReadBy === prev.readBy && nextStatus === prev.deliveryStatus) return list;
  const copy = list.slice();
  copy[idx] = { ...prev, ...normalized, text: nextText, readBy: nextReadBy, deliveryStatus: nextStatus };
  return copy;
}

function uniqueMessages(list: Message[]): Message[] {
  const seen = new Set<string>();
  const out: Message[] = [];
  for (const row of list) {
    const id = messageKey(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...row, id });
  }
  return out;
}
/** Presence HTTP beat — not per click/route. 45s is within the 30–60s TZ window. */
const PRESENCE_MIN_MS = 45_000;
let lastPresenceBeatAt = 0;
const notify = (kind: 'success' | 'error') => {
  telegramHaptic(kind);
};

/**
 * Website: public catalog first (never blocked by session).
 * Authoritative restore: POST /api/v2/auth/refresh only (no /session-probe).
 * 401/missing cookie → guest; transient network → network (keep cookie).
 * Telegram SDK is not used on website bootstrap.
 */
async function restoreWebsiteSession(): Promise<AuthBootstrap> {
  const manager = getSharedAuthManager();
  const googleReturn = consumeGoogleOAuthRedirect();
  if (googleReturn) {
    const googleIntent = consumeGoogleOAuthIntent();
    if (googleIntent === 'link') {
      try {
        await manager.refreshAccessToken();
        const access = manager.getAccessToken();
        if (googleReturn.ok && access) {
          await postAuthV2LinkGoogle({ idToken: googleReturn.idToken }, access);
        } else if (googleReturn.ok) {
          throw new Error('missing_session');
        }
        markBootstrapPhase('session-check', 0);
        markBootstrapPhase('cookie-check', 1);
        markBootstrapPhase('refresh', 0);
        markBootstrapPhase('telegram', 0);
        return { status: 'authenticated', mode: 'website' };
      } catch {
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', `${window.location.pathname || '/'}?auth_error=google_link`);
        }
        try {
          await manager.refreshAccessToken();
        } catch { /* keep whatever session remains */ }
        markBootstrapPhase('session-check', 0);
        markBootstrapPhase('cookie-check', manager.getAccessToken() ? 1 : 0);
        markBootstrapPhase('refresh', 0);
        markBootstrapPhase('telegram', 0);
        return manager.getAccessToken()
          ? { status: 'authenticated', mode: 'website' }
          : { status: 'guest' };
      }
    }
    if (googleReturn.ok) {
      try {
        const login = await postAuthV2Google({ idToken: googleReturn.idToken, rememberMe: true });
        manager.setSession(login.accessToken, login.expiresIn);
        markBootstrapPhase('session-check', 0);
        markBootstrapPhase('cookie-check', 1);
        markBootstrapPhase('refresh', 0);
        markBootstrapPhase('telegram', 0);
        return { status: 'authenticated', mode: 'website' };
      } catch {
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', `${window.location.pathname || '/'}?auth_error=google`);
        }
      }
    }
    // Google hop finished (cancel, mismatch, or API error). Do not revive the
    // previous Telegram cookie — that looks like "I signed in with Google and
    // landed on the old account".
    try {
      await postAuthV2Logout();
    } catch { /* cookie may already be gone */ }
    manager.clearSession('logout');
    markBootstrapPhase('session-check', 0);
    markBootstrapPhase('cookie-check', 0);
    markBootstrapPhase('refresh', 0);
    markBootstrapPhase('telegram', 0);
    return { status: 'guest' };
  }
  if (manager.getAccessToken() && !manager.isAccessExpired()) {
    markBootstrapPhase('session-check', 0);
    markBootstrapPhase('cookie-check', 0);
    markBootstrapPhase('refresh', 0);
    markBootstrapPhase('telegram', 0);
    return { status: 'authenticated', mode: 'website' };
  }
  if (getAccessToken()) {
    markBootstrapPhase('session-check', 0);
    markBootstrapPhase('cookie-check', 0);
    markBootstrapPhase('refresh', 0);
    markBootstrapPhase('telegram', 0);
    return { status: 'authenticated', mode: 'legacy' };
  }

  markBootstrapPhase('telegram', 0);
  // No cookie-probe hop: production disables /api/session-probe (404 → false "network"
  // → refresh storms / rotation races). Refresh cookie is the source of truth.
  markBootstrapPhase('session-check', 0);
  try {
    await bootstrapPhase('refresh', () => manager.refreshAccessToken());
    if (manager.getAccessToken()) {
      markBootstrapPhase('cookie-check', 1);
      return { status: 'authenticated', mode: 'website' };
    }
    markBootstrapPhase('cookie-check', 0);
    return { status: 'guest' };
  } catch (error) {
    markBootstrapPhase('cookie-check', 0);
    if (manager.getAccessToken() && !manager.isAccessExpired()) {
      return { status: 'authenticated', mode: 'website' };
    }
    if (getAccessToken()) return { status: 'authenticated', mode: 'legacy' };
    if (isTransientRefreshFailure(error)) return { status: 'network' };
    return { status: 'guest' };
  }
}

async function ensureWebsiteOrMiniAuth(): Promise<AuthBootstrap> {
  const miniSurface = await waitForTelegramMiniAppSurface();
  if (miniSurface || isTelegramMiniApp()) {
    const miniOk = await bootstrapPhase('telegram', async () => {
      // Wait for initData (SDK may need to parse tgWebAppData) before /telegram-mini.
      await ensureTelegramMiniAppReady();
      return bootstrapAuth();
    });
    if (miniOk) {
      void confirmWebsiteLoginFromMiniAppIfNeeded();
      return { status: 'authenticated', mode: 'mini' };
    }
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
  loadCatalog: () => Promise<void>,
): Promise<Profile | null> {
  const [profileResult] = await Promise.all([
    bootstrapPhase('me', () => loadProfile()),
    bootstrapPhase('products', () => load('products', API_PATHS.productsList({ limit: 15, offset: 0 }))),
    bootstrapPhase('catalog', () => loadCatalog()),
  ]);
  markBootstrapPhase('profile', 0);
  markBootstrapPhase('marketplace', 0);
  return profileResult;
}

function warmSecondaryCollections(
  profile: Profile | null,
  load: <K extends CollectionKey>(key: K, path: string, opts?: { silent?: boolean }) => Promise<void>,
  opts?: { silent?: boolean },
): void {
  void bootstrapPhase('orders', () => load('deals', API_PATHS.orders, opts));
  void bootstrapPhase('chats', () => load('chats', API_PATHS.chats, opts));
  if (profile) {
    // Keep the small Render/Neon pool free for orders/chats immediately after
    // auth. Reviews and notifications are below-the-fold background data.
    window.setTimeout(() => {
      void load('reviews', API_PATHS.reviews(profile.onixId));
      void load('notifications', API_PATHS.notifications);
    }, 750);
  }
}

export function useOnixCore() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionRestore, setSessionRestore] = useState<SessionRestore>('pending');
  const [catalogSubcategories, setCatalogSubcategories] = useState<SubcategoryCatalog>(SUBCATEGORIES_BY_CATEGORY);
  const [categoryLotCounts, setCategoryLotCounts] = useState<Record<string, number>>({});
  const [store, setStore] = useState<Store>(emptyStore);
  const [states, setStates] = useState<Record<CollectionKey | 'profile', AsyncState>>({
    profile: 'loading', products: 'idle', deals: 'idle', chats: 'idle', notifications: 'idle', reviews: 'idle',
  });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [presenceByOnixId, setPresenceByOnixId] = useState<Record<string, { online: boolean; lastOnline: string }>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [banFromAuth, setBanFromAuth] = useState<BanInfo | undefined>();
  const chatsRef = useRef(store.chats);
  chatsRef.current = store.chats;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const activeChatIdRef = useRef<string | null>(null);
  const actionBusyRef = useRef<string | null>(null);
  const purchaseLockRef = useRef(new Set<string>());
  const purchaseKeyRef = useRef(new Map<string, string>());

  const load = useCallback(async <K extends CollectionKey>(key: K, path: string, opts?: { silent?: boolean; fresh?: boolean }) => {
    if (!opts?.silent) {
      setStates(previous => ({ ...previous, [key]: 'loading' }));
    }
    try {
      // `fresh` passes a dummy AbortSignal so this GET does not join an in-flight
      // pre-mutation request (client GET dedupe is keyed by path and skipped when signal is set).
      const raw = await api.get<Store[K] | { items: Store[K] }>(path, opts?.fresh ? new AbortController().signal : undefined);
      const data = (raw && typeof raw === 'object' && 'items' in (raw as object) && Array.isArray((raw as { items: unknown }).items)
        ? (raw as { items: Store[K] }).items
        : raw) as Store[K];
      const next = key === 'products' ? visibleProducts(data as Product[]) as Store[K] : data;
      setStore(previous => ({ ...previous, [key]: next }));
      setErrors(previous => ({ ...previous, [key]: undefined }));
      setStates(previous => ({ ...previous, [key]: 'success' }));
    } catch (error) {
      setErrors(previous => ({ ...previous, [key]: friendlyError(error) }));
      setStates(previous => ({ ...previous, [key]: 'error' }));
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const data = await api.get<SubcategoryCatalog>(API_PATHS.subcategories);
      if (data && typeof data === 'object') {
        const next = { ...data };
        delete next.VALORANT;
        setCatalogSubcategories(next);
      }
    } catch {
      // Keep bootstrap fallback — form still works offline / on API blip.
    }
    try {
      const payload = await api.get<{ counts?: Record<string, number> }>(API_PATHS.productCategoryCounts);
      if (payload?.counts && typeof payload.counts === 'object') {
        setCategoryLotCounts(payload.counts);
      }
    } catch {
      /* catalog rings fall back to loaded products */
    }
  }, []);

  const loadProfile = useCallback(async (opts?: { keepOnTransient?: boolean }) => {
    setStates(previous => ({ ...previous, profile: 'loading' }));
    try {
      const complete = await api.get<Profile>(API_PATHS.me);
      setProfile(complete);
      setSessionRestore('authenticated');
      setErrors(previous => ({ ...previous, profile: undefined }));
      setStates(previous => ({ ...previous, profile: 'success' }));
      return complete;
    } catch (error) {
      const authRejected = error instanceof ApiError && (error.status === 401 || error.status === 403);
      if (!authRejected && isTransientRefreshFailure(error)) {
        const kept = profileRef.current;
        if (kept || opts?.keepOnTransient) {
          setErrors((previous) => ({
            ...previous,
            profile: 'Нет связи с сервером. Сессия сохранена — обновите страницу.',
          }));
          setStates((previous) => ({ ...previous, profile: kept ? 'success' : 'loading' }));
          return kept;
        }
      }
      if (authRejected) setSessionRestore('guest');
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
          setSessionRestore('guest');
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
        const current = await bootstrapMarketplace(loadProfile, load, loadCatalog);
        markAppReady('marketplace-ready');
        printBootstrapSummary('bootstrap-settled');
        markAppReady('bootstrap-settled');
        warmSecondaryCollections(current, load);
        return;
      }

      // Website:
      // 1) render shell (already)
      // 2) load public products (first paint) + session-check in parallel
      // 3) session OK → profile/orders/chats; 401 → guest (market already visible)
      markBootstrapPhase('telegram', 0);
      const alreadyAuthed = Boolean(profileRef.current) && Boolean(getAccessToken() || getSharedAuthManager().getAccessToken());
      if (alreadyAuthed) {
        const current = profileRef.current;
        setSessionRestore('authenticated');
        void loadProfile();
        void load('products', API_PATHS.productsList({ limit: 15, offset: 0 }), { silent: true });
        void loadCatalog();
        warmSecondaryCollections(current, load, { silent: true });
        printBootstrapSummary('bootstrap-settled');
        markAppReady('bootstrap-settled');
        return;
      }
      setStates((previous) => ({
        ...previous,
        products: previous.products === 'success' ? previous.products : 'loading',
        profile: 'loading',
      }));

      const productsPromise = bootstrapPhase('products-public', () =>
        load('products', API_PATHS.productsList({ limit: 15, offset: 0 })),
      );
      void bootstrapPhase('catalog', () => loadCatalog());
      const sessionPromise = restoreWebsiteSession();

      // Catalog readiness is independent of session (guest or user).
      const catalogReady = productsPromise.then(() => {
        markBootstrapPhase('marketplace', 0);
        markAppReady('marketplace-ready');
      });

      const boot = await sessionPromise;

      if (boot.status === 'guest') {
        setSessionRestore('guest');
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
          profile: 'Войдите через Telegram, чтобы покупать, продавать и писать в чат.',
        }));
        printBootstrapSummary('bootstrap-guest');
        markAppReady('bootstrap-settled');
        // Products continue in background — do not block guest on hung /api/products.
        void catalogReady;
        return;
      }

      if (boot.status === 'network') {
        // Transient refresh failure — keep HttpOnly cookie; do not flash guest login.
        setSessionRestore('network');
        if (!profileRef.current) {
          setStates((previous) => ({
            ...previous,
            profile: 'loading',
            deals: 'idle',
            chats: 'idle',
            notifications: 'idle',
            reviews: 'idle',
          }));
        }
        setErrors((previous) => ({
          ...previous,
          profile: 'Нет связи с сервером. Сессия ONIX сохранена — подождите или обновите страницу.',
        }));
        printBootstrapSummary('bootstrap-network');
        markAppReady('bootstrap-settled');
        void catalogReady;
        void (async () => {
          // RU CF path often succeeds on a later attempt after the first hung socket.
          const delaysMs = [1_200, 2_500, 5_000, 8_000];
          for (const wait of delaysMs) {
            await new Promise((r) => setTimeout(r, wait));
            const manager = getSharedAuthManager();
            if (manager.getAccessToken() && !manager.isAccessExpired()) {
              const current = await loadProfile({ keepOnTransient: true });
              if (current) setSessionRestore('authenticated');
              setErrors((previous) => ({ ...previous, profile: undefined }));
              void load('products', API_PATHS.productsList({ limit: 15, offset: 0 }), { silent: true, fresh: true });
              warmSecondaryCollections(current, load);
              return;
            }
            const again = await restoreWebsiteSession();
            if (again.status !== 'authenticated') continue;
            const current = await loadProfile({ keepOnTransient: true });
            if (current) setSessionRestore('authenticated');
            setErrors((previous) => ({ ...previous, profile: undefined }));
            void load('products', API_PATHS.productsList({ limit: 15, offset: 0 }), { silent: true, fresh: true });
            warmSecondaryCollections(current, load);
            return;
          }
          setSessionRestore((prev) => (prev === 'authenticated' ? prev : 'network'));
          setStates((previous) => ({
            ...previous,
            profile: profileRef.current ? 'success' : 'error',
          }));
        })();
        return;
      }

      // Session OK: profile may load alongside the public catalog, but the
      // personalized catalog must start only after that request settles.
      // This prevents two identical product bootstraps racing each other.
      setSessionRestore('authenticated');
      let current = await bootstrapPhase('profile-load', () => loadProfile({ keepOnTransient: true }));
      if (!current && getSharedAuthManager().getAccessToken()) {
        await new Promise((r) => setTimeout(r, 800));
        current = await loadProfile({ keepOnTransient: true });
      }
      markBootstrapPhase('profile', 0);
      await catalogReady;
      // Guest catalog already painted; refresh silently so favorites personalize without a second loading race.
      void load('products', API_PATHS.productsList({ limit: 15, offset: 0 }), { silent: true, fresh: true });
      printBootstrapSummary('bootstrap-settled');
      markAppReady('bootstrap-settled');
      warmSecondaryCollections(current, load);
    } catch (error) {
      if (isTransientRefreshFailure(error)) {
        setSessionRestore('network');
        setStates(previous => ({ ...previous, profile: profileRef.current ? 'success' : 'loading' }));
        setErrors(previous => ({ ...previous, profile: friendlyError(error) }));
        printBootstrapSummary('bootstrap-error');
        markAppReady('bootstrap-settled');
        return;
      }
      setProfile(null);
      setSessionRestore('guest');
      setStates(previous => ({ ...previous, profile: 'error' }));
      if (error instanceof ApiError && error.code === 'AUTH_ACCOUNT_LOCKED') {
        const ban = (error.details as { ban?: BanInfo } | undefined)?.ban;
        if (ban) setBanFromAuth(ban);
      }
      setErrors(previous => ({ ...previous, profile: friendlyError(error) }));
      printBootstrapSummary('bootstrap-error');
      markAppReady('bootstrap-settled');
    }
  }, [load, loadCatalog, loadProfile]);

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
    void refreshAll();
  }, [refreshAll]);

  // Peer tab login/logout shares the refresh cookie — keep this tab's profile in sync.
  useEffect(() => {
    if (isTelegramMiniApp()) return;
    const manager = getSharedAuthManager();
    return manager.subscribe((event: { type: string; accessToken?: string }) => {
      if (event.type === 'logout' || event.type === 'force-reauth') {
        setProfile(null);
        setStore(emptyStore);
        setMessages({});
        setPresenceByOnixId({});
        setSessionRestore('guest');
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
          profile: 'Вы вышли из аккаунта. Войдите через Telegram, чтобы продолжить.',
        }));
        return;
      }
      if (event.type !== 'token-updated' || !event.accessToken) return;
      const sub = readJwtSub(event.accessToken);
      const currentId = profileRef.current?.id;
      if (sub && currentId && sub === currentId) return;
      void (async () => {
        setStore(emptyStore);
        setMessages({});
        const next = await loadProfile({ keepOnTransient: true });
        if (!next) return;
        warmSecondaryCollections(next, load);
        void load('products', API_PATHS.productsList({ limit: 15, offset: 0 }), { silent: true, fresh: true });
      })();
    });
  }, [load, loadProfile]);

  // Ping origin while the tab is open — Render free tier sleeps after idle;
  // a warm instance cuts RU cold-start hangs on refresh/products.
  useEffect(() => {
    if (isTelegramMiniApp()) return;
    const ping = () => {
      void fetch('/api/health/live', { method: 'GET', cache: 'no-store', credentials: 'omit' })
        .catch(() => { /* offline */ });
    };
    const id = window.setInterval(ping, 4 * 60_000);
    const onVis = () => {
      if (!document.hidden) ping();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Keep lastSeenAt fresh on a timer — not on every click, focus, or screen switch.
  // getMe() already writes lastSeenAt; WS auth also announces online.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    let beating = false;
    if (lastPresenceBeatAt === 0) lastPresenceBeatAt = Date.now();
    const beat = async () => {
      if (cancelled || beating) return;
      if (Date.now() - lastPresenceBeatAt < PRESENCE_MIN_MS) return;
      beating = true;
      lastPresenceBeatAt = Date.now();
      try {
        const res = await api.post<{ lastOnline: string; online: boolean }>(API_PATHS.mePresence, {});
        if (cancelled || !res?.lastOnline) return;
        setProfile((prev) => {
          if (!prev || prev.lastOnline === res.lastOnline) return prev;
          return { ...prev, lastOnline: res.lastOnline };
        });
      } catch {
        /* ignore — offline / guest */
      } finally {
        beating = false;
      }
    };
    const id = window.setInterval(() => { void beat(); }, PRESENCE_MIN_MS);
    const onVis = () => {
      if (document.hidden) return;
      const rt = getRealtimeClient();
      if (!rt.isReady()) {
        const freshToken = async () => {
          const manager = getSharedAuthManager();
          const ensured = await manager.ensureAccessToken();
          if (ensured) return ensured;
          return getAccessToken();
        };
        rt.connect(freshToken);
      }
      void beat();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [profile?.onixId]);

  // Stage 5.6 — realtime fan-out (chat / presence / order / notifications).
  useEffect(() => {
    if (!profile) {
      getRealtimeClient().disconnect();
      return;
    }
    const rt = getRealtimeClient();
    const freshToken = async () => {
      const manager = getSharedAuthManager();
      const ensured = await manager.ensureAccessToken();
      if (ensured) return ensured;
      return getAccessToken();
    };
    rt.connect(freshToken);
    const off = rt.onMessage((msg) => {
      if (msg.type === 'chat.message') {
        const incoming = msg.message as Message;
        if (!incoming?.id) return;
        setMessages((previous) => {
          const list = previous[msg.chatId] ?? [];
          const next = appendUniqueMessage(list, incoming);
          if (next === list) return previous;
          return { ...previous, [msg.chatId]: next };
        });
        const viewing = activeChatIdRef.current === msg.chatId;
        setStore((previous) => ({
          ...previous,
          chats: previous.chats.map((chat) => {
            if (chat.id !== msg.chatId) return chat;
            return {
              ...chat,
              subtitle: incoming.text,
              unreadCount: viewing
                ? 0
                : msg.unreadDelta
                  ? (chat.unreadCount ?? 0) + msg.unreadDelta
                  : chat.unreadCount,
            };
          }),
        }));
        if (viewing) getRealtimeClient().markRead(msg.chatId);
        const aiThread = chatsRef.current.some((row) => row.id === msg.chatId && row.kind === 'AI');
        if (!incoming.mine && (incoming.kind !== 'SYSTEM' || aiThread)) playSound('notify');
        return;
      }
      if (msg.type === 'chat.read') {
        const reader = normOnixId(msg.onixId);
        const isMe = Boolean(profileRef.current && normOnixId(profileRef.current.onixId) === reader);
        if (isMe) {
          setStore((previous) => ({
            ...previous,
            chats: previous.chats.map((chat) => (
              chat.id === msg.chatId ? { ...chat, unreadCount: 0 } : chat
            )),
          }));
          return;
        }
        setMessages((previous) => {
          const list = previous[msg.chatId];
          if (!list) return previous;
          const readAt = new Date(msg.lastReadAt).getTime();
          let changed = false;
          const next = list.map((row) => {
            if (!row.mine || row.kind === 'SYSTEM') return row;
            if (new Date(row.createdAt).getTime() > readAt) return row;
            const already = row.readBy?.some((item) => normOnixId(item.onixId) === reader);
            if (already && row.deliveryStatus === 'READ') return row;
            changed = true;
            return {
              ...row,
              deliveryStatus: 'READ' as const,
              readBy: already
                ? row.readBy
                : [...(row.readBy ?? []), { onixId: msg.onixId, username: msg.username, readAt: msg.lastReadAt }],
            };
          });
          return changed ? { ...previous, [msg.chatId]: next } : previous;
        });
        return;
      }
      if (msg.type === 'presence') {
        const key = normOnixId(msg.onixId);
        // Presence map is the source of truth for online dots / last-seen.
        // Do not remap products/chats/deals — that re-renders the whole app on every beat.
        startTransition(() => {
          setPresenceByOnixId((previous) => {
            const cur = previous[key];
            if (cur && cur.online === msg.online && cur.lastOnline === msg.lastOnline) return previous;
            return { ...previous, [key]: { online: msg.online, lastOnline: msg.lastOnline } };
          });
        });
        return;
      }
      if (msg.type === 'order.updated') {
        if (msg.sound === 'order') playSound('order');
        void load('deals', API_PATHS.orders, { silent: true });
        void load('chats', API_PATHS.chats, { silent: true });
        return;
      }
      if (msg.type === 'product.changed') {
        if (msg.status !== 'ACTIVE') {
          hideCatalogProduct(msg.productId);
          setStore((previous) => ({
            ...previous,
            products: previous.products.filter((p) => p.id !== msg.productId),
          }));
          return;
        }
        const wasHidden = isCatalogHidden(msg.productId);
        showCatalogProduct(msg.productId);
        if (msg.created || wasHidden) {
          // New listing or restore after reserve/cancel — fetch a post-commit snapshot.
          void load('products', API_PATHS.productsList({ limit: 15, offset: 0 }), { silent: true, fresh: true });
          return;
        }
        setStore((previous) => ({
          ...previous,
          products: previous.products.map((p) => (
            p.id === msg.productId
              ? { ...p, status: 'ACTIVE' as const, quantity: msg.quantity }
              : p
          )),
        }));
        return;
      }
      if (msg.type === 'notification') {
        const chatId = typeof msg.data?.chatId === 'string' ? msg.data.chatId : undefined;
        const orderId = typeof msg.data?.orderId === 'string' ? msg.data.orderId : undefined;
        const viewing = Boolean(chatId && activeChatIdRef.current === chatId);
        setStore((previous) => ({
          ...previous,
          notifications: [
            {
              id: msg.id,
              title: msg.title,
              body: msg.body,
              createdAt: msg.createdAt,
              read: viewing,
              ...(chatId ? { chatId } : {}),
              ...(orderId ? { orderId } : {}),
            },
            ...previous.notifications,
          ].slice(0, 100),
        }));
        if (!viewing && !isOrderNotification(msg.title, msg.body)) playSound('notify');
      }
    });
    // Keep token provider warm; reconnect if socket dropped auth.
    const tokenRefresh = window.setInterval(() => {
      void freshToken().then((token) => {
        if (!token) return;
        if (!rt.isReady()) rt.connect(freshToken);
      });
    }, 45_000);
    return () => {
      off();
      window.clearInterval(tokenRefresh);
    };
  }, [profile?.onixId, load]);

  const subscribeRealtimeChat = useCallback((chatId: string) => {
    getRealtimeClient().subscribeChat(chatId);
  }, []);

  const unsubscribeRealtimeChat = useCallback((chatId: string) => {
    getRealtimeClient().unsubscribeChat(chatId);
  }, []);

  const sendRealtimeTyping = useCallback((chatId: string) => {
    getRealtimeClient().typing(chatId);
  }, []);

  const run = useCallback(async <T,>(key: string, request: () => Promise<T>, after?: () => void): Promise<T | null> => {
    if (actionBusyRef.current) return null;
    actionBusyRef.current = key;
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
      actionBusyRef.current = null;
      setActionBusy(null);
    }
  }, []);

  const cents = (rubles: string | number) => rublesToCentsString(rubles);

  const listProducts = useCallback((query: ProductListQuery = {}, signal?: AbortSignal) =>
    api.get<Product[]>(API_PATHS.productsList(query), signal).then(visibleProducts), []);

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
      warrantyHours: draft.warrantyHours ?? 10,
      acceptedRules: true,
    }), () => void load('products', API_PATHS.productsList({ limit: 15, offset: 0 }))), [load, run]);

  const updateProduct = useCallback((id: string, draft: ProductDraft) => run('product-form', () =>
    api.patch<Product>(API_PATHS.productUpdate(id), {
      title: draft.title.trim(), description: draft.description.trim(), priceCents: cents(draft.priceRubles),
      quantity: draft.quantity, category: draft.category, subcategory: draft.subcategory.trim() || undefined,
      autoDeliver: Boolean(draft.autoDeliver),
      ...(draft.autoDeliver && draft.deliveryText?.trim()
        ? { deliveryText: draft.deliveryText.trim() }
        : {}),
    }), () => void load('products', API_PATHS.productsList({ limit: 15, offset: 0 }))), [load, run]);

  const archiveProduct = useCallback((id: string) => run(`archive-${id}`, () =>
    api.delete<Product>(API_PATHS.productDelete(id)),
  () => void load('products', API_PATHS.productsList({ limit: 15, offset: 0 }))), [load, run]);

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

  const purchase = useCallback(async (productId: string, idempotencyKey?: string) => {
    if (!productId || purchaseLockRef.current.has(productId) || actionBusyRef.current) return null;
    purchaseLockRef.current.add(productId);
    hideCatalogProduct(productId);
    setStore((previous) => ({
      ...previous,
      products: previous.products.filter((p) => p.id !== productId),
    }));
    try {
      let key = idempotencyKey ?? purchaseKeyRef.current.get(productId);
      if (!key) {
        key = crypto.randomUUID();
        purchaseKeyRef.current.set(productId, key);
      } else {
        purchaseKeyRef.current.set(productId, key);
      }
      const result = await run(`purchase-${productId}`, () =>
        api.post<Deal>(API_PATHS.productPurchase(productId), {
          idempotencyKey: key,
          quantity: 1,
        }), () => {
          void load('products', API_PATHS.productsList({ limit: 15, offset: 0 }), { silent: true, fresh: true });
          void load('deals', API_PATHS.orders, { silent: true, fresh: true });
          void load('chats', API_PATHS.chats, { silent: true, fresh: true });
        });
      if (result) purchaseKeyRef.current.delete(productId);
      if (!result) {
        showCatalogProduct(productId);
        void load('products', API_PATHS.productsList({ limit: 15, offset: 0 }), { silent: true, fresh: true });
      }
      return result;
    } finally {
      purchaseLockRef.current.delete(productId);
    }
  }, [load, run]);

  const loadMessages = useCallback(async (threadId: string) => {
    try {
      const data = await api.get<Message[]>(API_PATHS.messages(threadId));
      setMessages((previous) => {
        const existing = previous[threadId] ?? [];
        const server = uniqueMessages(data);
        const serverIds = new Set(server.map((m) => m.id));
        const pendingOnly = existing.filter((m) => m.pending && !serverIds.has(m.id));
        const merged = pendingOnly.length ? [...server, ...pendingOnly] : server;
        const same =
          existing.length === merged.length
          && existing.every((m, i) => (
            m.id === merged[i]?.id
            && m.deliveryStatus === merged[i]?.deliveryStatus
            && (m.readBy?.length ?? 0) === (merged[i]?.readBy?.length ?? 0)
          ));
        if (same) return previous;
        return { ...previous, [threadId]: merged };
      });
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

  const sendLock = useRef(new Set<string>());
  const sendMessage = useCallback(async (threadId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const lockKey = `message-${threadId}`;
    if (sendLock.current.has(lockKey)) return false;
    sendLock.current.add(lockKey);
    try {
      const result = await run(lockKey, () => api.post<Message>(API_PATHS.messages(threadId), { text: trimmed }));
      if (result) {
        setMessages((previous) => {
          const list = previous[threadId] || [];
          const next = appendUniqueMessage(list, result);
          if (next === list) return previous;
          return { ...previous, [threadId]: next };
        });
        return true;
      }
      return false;
    } finally {
      sendLock.current.delete(lockKey);
    }
  }, [run]);

  const sendChatAttachment = useCallback(async (
    threadId: string,
    _file: File,
    _caption?: string,
  ) => {
    setErrors((previous) => ({
      ...previous,
      [`message-${threadId}`]: 'Вложения в чате временно отключены. Отправьте текстовое сообщение.',
    }));
    return false;
  }, []);

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

  const dealIdempotencyRef = useRef(new Map<string, string>());

  const openSupport = useCallback((dealId: string, reason?: string) => {
    const stamp = `${dealId}:support`;
    let key = dealIdempotencyRef.current.get(stamp);
    if (!key) {
      key = crypto.randomUUID();
      dealIdempotencyRef.current.set(stamp, key);
    }
    return run(`support-${dealId}`, () =>
      api.post<{ ticketId: string; chatId: string }>(API_PATHS.orderSupport(dealId), {
        idempotencyKey: key,
        ...(reason ? { reason } : {}),
      }), () => {
        void load('chats', API_PATHS.chats);
        void load('deals', API_PATHS.orders);
      });
  }, [load, run]);

  const dealAction = useCallback((deal: Deal, action: 'deliver' | 'complete' | 'dispute') => {
    if (action === 'dispute') {
      return openSupport(deal.id, 'Открыто пользователем');
    }
    const path = action === 'deliver'
      ? API_PATHS.dealDeliver(deal.id)
      : API_PATHS.dealComplete(deal.id);
    const stamp = `${deal.id}:${action}`;
    let key = dealIdempotencyRef.current.get(stamp);
    if (!key) {
      key = crypto.randomUUID();
      dealIdempotencyRef.current.set(stamp, key);
    }
    return run(`deal-${deal.id}`, () => api.post(path, {
      idempotencyKey: key,
    }), () => void load('deals', API_PATHS.orders, { silent: true, fresh: true }));
  }, [load, openSupport, run]);

  const withdrawKeyRef = useRef<string | null>(null);
  const withdraw = useCallback((amountRubles: number, stepUpChallengeId?: string) => {
    if (!withdrawKeyRef.current) withdrawKeyRef.current = crypto.randomUUID();
    const key = withdrawKeyRef.current;
    return run('withdraw', () =>
      api.post(API_PATHS.walletWithdraw, {
        amountCents: rublesToCentsString(amountRubles),
        idempotencyKey: key,
        ...(stepUpChallengeId ? { stepUpChallengeId } : {}),
      }), async () => {
        withdrawKeyRef.current = null;
        await loadProfile();
      });
  }, [loadProfile, run]);

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

  const markChatNotificationsRead = useCallback(async (chatId: string) => {
    let ids: string[] = [];
    setStore((previous) => {
      ids = previous.notifications
        .filter((item) => !item.read && item.chatId === chatId && /^\d+$/.test(item.id))
        .map((item) => item.id);
      if (ids.length === 0) return previous;
      return {
        ...previous,
        notifications: previous.notifications.map((item) => (
          item.chatId === chatId ? { ...item, read: true } : item
        )),
      };
    });
    await Promise.all(ids.map((id) => api.patch(API_PATHS.notificationRead(id), {}).catch(() => undefined)));
  }, []);

  const setActiveChatId = useCallback((chatId: string | null) => {
    activeChatIdRef.current = chatId;
    if (chatId) {
      getRealtimeClient().markRead(chatId);
      void markChatNotificationsRead(chatId);
    }
  }, [markChatNotificationsRead]);

  const listDeals = useCallback(async (query: OrderListQuery = {}, signal?: AbortSignal) => {
    setStates((previous) => (
      previous.deals === 'success' ? previous : { ...previous, deals: 'loading' }
    ));
    try {
      const data = await api.get<Deal[]>(API_PATHS.ordersList(query), signal);
      if (signal?.aborted) return null;
      setStore(previous => ({ ...previous, deals: data }));
      setErrors(previous => ({ ...previous, deals: undefined }));
      setStates(previous => ({ ...previous, deals: 'success' }));
      return data;
    } catch (error) {
      if (signal?.aborted) return null;
      setErrors(previous => ({ ...previous, deals: friendlyError(error) }));
      setStates(previous => ({ ...previous, deals: 'error' }));
      return null;
    }
  }, []);

  const sellerRefund = useCallback((dealId: string, reason: string) => {
    const stamp = `${dealId}:seller-refund`;
    let key = dealIdempotencyRef.current.get(stamp);
    if (!key) {
      key = crypto.randomUUID();
      dealIdempotencyRef.current.set(stamp, key);
    }
    return run(`seller-refund-${dealId}`, () =>
      api.post(API_PATHS.orderRefundRequest(dealId), { reason, idempotencyKey: key }),
    () => {
      dealIdempotencyRef.current.delete(stamp);
      void load('deals', API_PATHS.orders, { silent: true, fresh: true });
    });
  }, [load, run]);

  /** Website / PWA only — revoke session and return to AuthGate. Hidden in Telegram Mini App. */
  const signOut = useCallback(async () => {
    if (isTelegramMiniApp()) return;
    try {
      await postAuthV2Logout();
    } catch {
      /* still drop local tokens — cookie clear is best-effort */
    }
    clearAccessToken();
    getSharedAuthManager().clearSession('logout');
    setProfile(null);
    setStore(emptyStore);
    setMessages({});
    setPresenceByOnixId({});
    setSessionRestore('guest');
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
      profile: 'Вы вышли из аккаунта. Войдите через Telegram, чтобы продолжить.',
    }));
  }, []);

  const presenceOf = useCallback((onixId: string) => {
    return presenceByOnixId[normOnixId(onixId)] ?? null;
  }, [presenceByOnixId]);

  // Badge: chat unread only (in-app notifications stay for API/history; UI tab removed).
  const unread = useMemo(() => store.chats.reduce((total, chat) => total + chat.unreadCount, 0), [store.chats]);

  return useMemo(() => ({
    profile, catalogSubcategories, categoryLotCounts, ...store, states, errors, messages, actionBusy, unread, banFromAuth,
    sessionRestore,
    presenceByOnixId, presenceOf,
    refreshAll, loadProfile, loadMessages, refreshChats, searchChats, listProducts, listFavorites, listDeals, createProduct, updateProduct, archiveProduct, toggleFavorite,
    toggleFollow, purchase, dealAction, openSupport, sellerRefund, startChat, sendMessage, sendChatAttachment, withdraw, submitReview,
    markNotificationRead, reportUser, signOut,
    subscribeRealtimeChat, unsubscribeRealtimeChat, sendRealtimeTyping, setActiveChatId,
  }), [
    profile, catalogSubcategories, categoryLotCounts, store, states, errors, messages, actionBusy, unread, banFromAuth,
    sessionRestore, presenceByOnixId, presenceOf,
    refreshAll, loadProfile, loadMessages, refreshChats, searchChats, listProducts, listFavorites, listDeals, createProduct, updateProduct, archiveProduct, toggleFavorite,
    toggleFollow, purchase, dealAction, openSupport, sellerRefund, startChat, sendMessage, sendChatAttachment, withdraw, submitReview,
    markNotificationRead, reportUser, signOut,
    subscribeRealtimeChat, unsubscribeRealtimeChat, sendRealtimeTyping, setActiveChatId,
  ]);
}
