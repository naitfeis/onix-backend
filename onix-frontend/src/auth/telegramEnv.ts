/**
 * Telegram Mini App helpers.
 *
 * Critical rule: never load @twa-dev/sdk on ordinary www.
 * The SDK stub creates window.Telegram.WebApp with empty initData / platform "unknown"
 * and auto-posts web_app_request_theme / web_app_request_viewport on import.
 *
 * Website cookie auth must not depend on Telegram. Mini App uses Telegram-injected WebApp
 * (and optionally loads the SDK only after real Mini App detection).
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
 * Do not treat SDK stubs (empty initData + platform "unknown") as Mini App.
 */
function computeIsTelegramMiniApp(): boolean {
  const data = readInjectedWebApp()?.initData;
  if (data && data.length > 0) return true;
  return hasTgWebAppUrlMarker();
}

/** True inside Telegram Mini App (non-empty initData or tgWebAppData URL markers). */
export function isTelegramMiniApp(): boolean {
  const result = computeIsTelegramMiniApp();
  logTelegramDetect('isTelegramMiniApp()', result);
  return result;
}

export function getTelegramInitData(): string {
  return readInjectedWebApp()?.initData ?? '';
}

async function loadTwaSdk(): Promise<TelegramWebAppLike | undefined> {
  try {
    const mod = await import('@twa-dev/sdk') as TwaSdkModule;
    return mod.default;
  } catch {
    return undefined;
  }
}

/**
 * Call Telegram ready/expand only after Mini App is confirmed.
 * Prefer injected WebApp; load SDK only as a fallback (never on ordinary www).
 */
export function signalTelegramReadyIfMiniApp(): void {
  if (!computeIsTelegramMiniApp()) {
    logTelegramDetect('signalTelegramReadyIfMiniApp:skip-not-mini');
    return;
  }

  const injected = readInjectedWebApp();
  if (injected?.ready || injected?.expand) {
    try {
      injected.ready?.();
      logTelegramDetect('after injected.ready()');
      injected.expand?.();
      return;
    } catch {
      /* fall through to SDK */
    }
  }

  void loadTwaSdk().then((sdk) => {
    if (!sdk) {
      logTelegramDetect('signalTelegramReadyIfMiniApp:no-telegram');
      return;
    }
    try {
      sdk.ready?.();
      logTelegramDetect('after WebApp.ready()');
      sdk.expand?.();
    } catch {
      logTelegramDetect('signalTelegramReadyIfMiniApp:sdk-failed');
    }
  });
}

export function telegramHaptic(kind: 'success' | 'error'): void {
  if (!computeIsTelegramMiniApp()) return;
  try {
    telegramWebApp()?.HapticFeedback?.notificationOccurred?.(kind);
  } catch {
    /* ignore */
  }
}

export function telegramImpact(style = 'light'): void {
  if (!computeIsTelegramMiniApp()) return;
  try {
    telegramWebApp()?.HapticFeedback?.impactOccurred?.(style);
  } catch {
    /* ignore */
  }
}
