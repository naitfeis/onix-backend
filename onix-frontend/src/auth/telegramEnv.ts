/**
 * Telegram Mini App helpers.
 *
 * Critical rule: never load @twa-dev/sdk on ordinary www.
 * The SDK stub creates window.Telegram.WebApp with empty initData / platform "unknown"
 * and auto-posts web_app_request_theme / web_app_request_viewport on import.
 *
 * Website cookie auth must not depend on Telegram. Mini App loads SDK only after
 * real Mini App detection, and must await ready + initData before auto-login.
 */

type TelegramWebAppLike = {
  initData?: string;
  initDataUnsafe?: { start_param?: string };
  platform?: string;
  ready?: () => void;
  expand?: () => void;
  /** Bot API 6.9+. Shows the native "share your phone number" popup. */
  requestContact?: (callback?: (shared: boolean) => void) => void;
  HapticFeedback?: {
    notificationOccurred?: (kind: 'success' | 'error' | 'warning') => void;
    impactOccurred?: (style: string) => void;
  };
};

type TwaSdkModule = { default: TelegramWebAppLike };

let miniAppReadyPromise: Promise<string> | null = null;
/** Set after ensureTelegramMiniAppReady — covers SDK initData before inject sync. */
let ensuredInitData = '';

/**
 * Cached detect result for this page load.
 * - `true` sticks once initData / markers confirm Mini App.
 * - `false` is never cached: Telegram inject often arrives after the first JS tick.
 */
let cachedIsMiniApp: boolean | undefined;
let lastDetectLogKey: string | undefined;

function readInjectedWebApp(): TelegramWebAppLike | undefined {
  try {
    const root = globalThis as typeof globalThis & {
      Telegram?: { WebApp?: TelegramWebAppLike };
      window?: Window & { Telegram?: { WebApp?: TelegramWebAppLike } };
    };
    return root.Telegram?.WebApp ?? root.window?.Telegram?.WebApp;
  } catch {
    return undefined;
  }
}

function telegramWebApp(): TelegramWebAppLike | undefined {
  return readInjectedWebApp();
}

function hasTgWebAppUrlMarker(): boolean {
  try {
    const hash = typeof location !== 'undefined' ? location.hash : '';
    const search = typeof location !== 'undefined' ? location.search : '';
    return hash.includes('tgWebAppData') || search.includes('tgWebAppData');
  } catch {
    return false;
  }
}

/** Temporary detect probe — logs only, no control-flow changes. */
export function logTelegramDetect(label: string, detectResult?: boolean): void {
  try {
    const root = globalThis as typeof globalThis & { Telegram?: { WebApp?: TelegramWebAppLike } };
    const injected = readInjectedWebApp();
    const initData = injected?.initData ?? '';
    const platform = injected?.platform ?? '';
    const result = detectResult ?? computeIsTelegramMiniApp();
    const key = `${label}:${result}:${initData.length}:${platform}:${Boolean(root.Telegram)}`;
    if (key === lastDetectLogKey) return;
    lastDetectLogKey = key;
    // Dev-only — production console stays clean (bootstrap timing is enough).
    if (!import.meta.env.DEV) return;
      console.info('[tg-detect]', {
      label,
      now: Date.now(),
      initDataLength: initData.length,
      platform,
      windowTelegramExists: Boolean(root.Telegram),
      windowTelegramWebAppExists: Boolean(injected),
      sdkWebAppExists: false,
      isTelegramMiniApp: result,
      urlHasTgWebAppData: hasTgWebAppUrlMarker(),
    });
  } catch {
    /* ignore probe failures */
  }
}

/**
 * True only inside a real Telegram Mini App.
 * Without a static SDK import, platform "unknown" does not appear on ordinary www.
 */
function computeIsTelegramMiniApp(): boolean {
  const tg = readInjectedWebApp();
  const data = tg?.initData;
  if (data && data.length > 0) return true;
  if (hasTgWebAppUrlMarker()) return true;
  const platform = tg?.platform;
  if (platform && platform !== 'unknown' && platform !== '') return true;
  return false;
}

function looksLikeTelegramWebView(): boolean {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (/Telegram/i.test(ua)) return true;
    const root = globalThis as typeof globalThis & { TelegramWebviewProxy?: unknown };
    if (root.TelegramWebviewProxy) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function isSdkStubOnly(): boolean {
  const tg = readInjectedWebApp();
  if (!tg) return false;
  const platform = tg.platform ?? '';
  const empty = !tg.initData;
  return empty && (platform === 'unknown' || platform === '') && !looksLikeTelegramWebView() && !hasTgWebAppUrlMarker();
}

function shouldWaitForTelegramInject(): boolean {
  if (computeIsTelegramMiniApp()) return false;
  if (isSdkStubOnly()) return false;
  return looksLikeTelegramWebView() || hasTgWebAppUrlMarker() || Boolean(readInjectedWebApp());
}

/** True inside Telegram Mini App (initData / URL markers / native platform). */
export function isTelegramMiniApp(): boolean {
  if (cachedIsMiniApp === true) return true;

  const result = computeIsTelegramMiniApp();
  if (result) {
    cachedIsMiniApp = true;
    logTelegramDetect('isTelegramMiniApp:true', true);
    return true;
  }

  // Never cache false: Telegram often injects WebApp after the first JS tick.
  // Caching false made Mini App boot as www, then look like a full refresh.
  logTelegramDetect('isTelegramMiniApp:pending-or-www', false);
  return false;
}

/**
 * Mini App WebView often injects `Telegram.WebApp` a tick after JS starts.
 * Wait briefly when the surface looks like Telegram; no-op on ordinary www.
 */
export async function waitForTelegramMiniAppSurface(timeoutMs = 1800): Promise<boolean> {
  if (computeIsTelegramMiniApp()) {
    cachedIsMiniApp = true;
    await ensureTelegramMiniAppReady();
    return true;
  }
  if (!shouldWaitForTelegramInject()) return false;
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    if (computeIsTelegramMiniApp()) {
      cachedIsMiniApp = true;
      await ensureTelegramMiniAppReady();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (computeIsTelegramMiniApp()) {
    cachedIsMiniApp = true;
    await ensureTelegramMiniAppReady();
    return true;
  }
  return false;
}

export function getTelegramInitData(): string {
  const live = readInjectedWebApp()?.initData ?? '';
  return live || ensuredInitData;
}

/** startapp / start_param passed when the Mini App is opened from a website login link. */
export function getTelegramStartParam(): string {
  const tg = readInjectedWebApp();
  const unsafe = tg?.initDataUnsafe?.start_param?.trim();
  if (unsafe) return unsafe;
  try {
    const params = new URLSearchParams(tg?.initData || ensuredInitData || '');
    const fromInit = params.get('start_param')?.trim();
    if (fromInit) return fromInit;
  } catch {
    /* ignore */
  }
  try {
    const hash = typeof location !== 'undefined' ? location.hash : '';
    const search = typeof location !== 'undefined' ? location.search : '';
    const combined = `${search}&${hash.replace(/^#/, '')}`;
    const match = combined.match(/(?:^|[?&#])tgWebAppStartParam=([^&]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]).trim();
  } catch {
    /* ignore */
  }
  return '';
}

async function loadTwaSdk(): Promise<TelegramWebAppLike | undefined> {
  try {
    const mod = await import('@twa-dev/sdk') as TwaSdkModule;
    return mod.default;
  } catch {
    return undefined;
  }
}

function signalReady(tg: TelegramWebAppLike | undefined): void {
  try {
    tg?.ready?.();
    const expanded = (tg as TelegramWebAppLike & { isExpanded?: boolean })?.isExpanded;
    if (!expanded) tg?.expand?.();
  } catch {
    /* ignore */
  }
}

/**
 * Mini App only: ensure WebApp is ready and initData is readable before auto-login.
 * Loads @twa-dev/sdk only when needed (e.g. initData lives in tgWebAppData hash).
 * Safe no-op on ordinary www.
 */
export async function ensureTelegramMiniAppReady(): Promise<string> {
  if (!computeIsTelegramMiniApp()) {
    logTelegramDetect('ensureTelegramMiniAppReady:skip-not-mini');
    return '';
  }

  if (!miniAppReadyPromise) {
    miniAppReadyPromise = (async () => {
      let initData = readInjectedWebApp()?.initData ?? '';
      if (initData) {
        signalReady(readInjectedWebApp());
        ensuredInitData = initData;
        cachedIsMiniApp = true;
        logTelegramDetect('ensureTelegramMiniAppReady:injected');
        return initData;
      }

      // Hash/platform markers without initData yet — load SDK to parse tgWebAppData.
      const sdk = await loadTwaSdk();
      signalReady(sdk ?? readInjectedWebApp());
      initData = (sdk?.initData && String(sdk.initData))
        || (readInjectedWebApp()?.initData ?? '');
      ensuredInitData = initData;
      if (initData) cachedIsMiniApp = true;
      logTelegramDetect('ensureTelegramMiniAppReady:sdk', Boolean(initData));
      return initData;
    })();
  }

  return miniAppReadyPromise;
}

/**
 * Fire-and-forget ready for shell mount. Auth path must use ensureTelegramMiniAppReady().
 */
export function signalTelegramReadyIfMiniApp(): void {
  if (!computeIsTelegramMiniApp()) {
    logTelegramDetect('signalTelegramReadyIfMiniApp:skip-not-mini');
    return;
  }
  void ensureTelegramMiniAppReady();
}

export function telegramHaptic(kind: 'success' | 'error'): void {
  if (!isTelegramMiniApp()) return;
  try {
    telegramWebApp()?.HapticFeedback?.notificationOccurred?.(kind);
  } catch {
    /* ignore */
  }
}

export function telegramImpact(style = 'light'): void {
  if (!isTelegramMiniApp()) return;
  try {
    telegramWebApp()?.HapticFeedback?.impactOccurred?.(style);
  } catch {
    /* ignore */
  }
}

/**
 * Ask Telegram to show the native "share your phone number" popup (Bot API 6.9+).
 *
 * Important for seller verification: the phone number is delivered to the BOT via the
 * webhook as `message.contact` — the Mini App only learns whether the user accepted.
 * So a `true` result means "ask the profile again", never "we have the number".
 *
 * Resolves `false` outside a Mini App, on older Telegram clients, and when the user
 * declines; callers must not treat those cases differently from each other.
 */
export async function requestTelegramContact(timeoutMs = 30_000): Promise<boolean> {
  const webApp = telegramWebApp();
  if (!webApp?.requestContact) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (shared: boolean) => {
        if (settled) return;
        settled = true;
        resolve(shared);
      };
      // Some clients never invoke the callback if the popup is dismissed by gesture.
      window.setTimeout(() => finish(false), timeoutMs);
      webApp.requestContact?.(finish);
    });
  } catch {
    return false;
  }
}
