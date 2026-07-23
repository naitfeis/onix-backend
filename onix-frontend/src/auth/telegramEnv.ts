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
  platform?: string;
  ready?: () => void;
  expand?: () => void;
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
 * - `false` sticks only for definitive www (no inject, no tgWebAppData URL).
 * Ambiguous cases (empty WebApp stub / URL-only) are not cached as false.
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
    // eslint-disable-next-line no-console
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

/** True inside Telegram Mini App (initData / URL markers / native platform). */
export function isTelegramMiniApp(): boolean {
  if (cachedIsMiniApp === true) return true;
  if (cachedIsMiniApp === false) return false;

  const result = computeIsTelegramMiniApp();
  if (result) {
    cachedIsMiniApp = true;
    logTelegramDetect('isTelegramMiniApp:true', true);
    return true;
  }

  // Definitive ordinary www — safe to cache for the page lifetime.
  if (!readInjectedWebApp() && !hasTgWebAppUrlMarker()) {
    cachedIsMiniApp = false;
    logTelegramDetect('isTelegramMiniApp:false', false);
    return false;
  }

  // Ambiguous: empty inject / pending initData — recompute next call, log once.
  logTelegramDetect('isTelegramMiniApp:pending', false);
  return false;
}

export function getTelegramInitData(): string {
  const live = readInjectedWebApp()?.initData ?? '';
  return live || ensuredInitData;
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
    tg?.expand?.();
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
