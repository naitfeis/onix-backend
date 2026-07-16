/**
 * Telegram Mini App helpers.
 * Website must not wait on Telegram; Mini App uses injected WebApp + @twa-dev/sdk.
 */

import WebApp from '@twa-dev/sdk';

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

function telegramWebApp(): TelegramWebAppLike | undefined {
  try {
    // Prefer SDK wrapper (stable in Telegram WebView); fall back to injected object.
    return WebApp as unknown as TelegramWebAppLike;
  } catch {
    /* SDK unavailable */
  }
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
    const root = globalThis as typeof globalThis & {
      Telegram?: { WebApp?: TelegramWebAppLike };
      window?: Window & { Telegram?: { WebApp?: TelegramWebAppLike } };
    };
    const winTg = typeof window !== 'undefined'
      ? (window as Window & { Telegram?: { WebApp?: TelegramWebAppLike } }).Telegram
      : undefined;
    const injected = root.Telegram?.WebApp ?? root.window?.Telegram?.WebApp ?? winTg?.WebApp;
    const tg = telegramWebApp();
    const initData = tg?.initData ?? '';
    const platform = tg?.platform ?? '';
    const result = detectResult ?? computeIsTelegramMiniApp();
    // eslint-disable-next-line no-console
    console.info('[tg-detect]', {
      label,
      now: Date.now(),
      initDataLength: initData.length,
      platform,
      windowTelegramExists: Boolean(winTg ?? root.Telegram ?? root.window?.Telegram),
      windowTelegramWebAppExists: Boolean(injected),
      sdkWebAppExists: Boolean(WebApp),
      isTelegramMiniApp: result,
      urlHasTgWebAppData: hasTgWebAppUrlMarker(),
    });
  } catch {
    /* ignore probe failures */
  }
}

function computeIsTelegramMiniApp(): boolean {
  const tg = telegramWebApp();
  const data = tg?.initData;
  if (data && data.length > 0) return true;
  if (hasTgWebAppUrlMarker()) return true;
  const platform = tg?.platform;
  if (platform && platform !== 'unknown' && platform !== '') return true;
  return false;
}

/** True inside Telegram Mini App (initData / WebApp / URL markers). */
export function isTelegramMiniApp(): boolean {
  const result = computeIsTelegramMiniApp();
  logTelegramDetect('isTelegramMiniApp()', result);
  return result;
}

export function getTelegramInitData(): string {
  try {
    const fromSdk = WebApp.initData;
    if (fromSdk) return fromSdk;
  } catch {
    /* ignore */
  }
  return telegramWebApp()?.initData ?? '';
}

/** Call Telegram.ready/expand when WebApp exists — required for Mini App initData. */
export function signalTelegramReadyIfMiniApp(): void {
  try {
    const tg = telegramWebApp();
    if (!tg && !hasTgWebAppUrlMarker()) {
      logTelegramDetect('signalTelegramReadyIfMiniApp:skip-no-tg');
      return;
    }
    WebApp.ready();
    logTelegramDetect('after WebApp.ready()');
    WebApp.expand();
  } catch {
    try {
      const tg = telegramWebApp();
      tg?.ready?.();
      logTelegramDetect('after tg.ready() fallback');
      tg?.expand?.();
    } catch {
      logTelegramDetect('signalTelegramReadyIfMiniApp:no-telegram');
      /* Ordinary www — no Telegram. */
    }
  }
}

export function telegramHaptic(kind: 'success' | 'error'): void {
  if (!isTelegramMiniApp()) return;
  try {
    WebApp.HapticFeedback.notificationOccurred(kind);
  } catch {
    try {
      telegramWebApp()?.HapticFeedback?.notificationOccurred?.(kind);
    } catch {
      /* ignore */
    }
  }
}

export function telegramImpact(style = 'light'): void {
  if (!isTelegramMiniApp()) return;
  try {
    WebApp.HapticFeedback.impactOccurred(style as 'light' | 'medium' | 'heavy' | 'rigid' | 'soft');
  } catch {
    try {
      telegramWebApp()?.HapticFeedback?.impactOccurred?.(style);
    } catch {
      /* ignore */
    }
  }
}
