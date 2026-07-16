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

/** True inside Telegram Mini App (initData / WebApp / URL markers). */
export function isTelegramMiniApp(): boolean {
  const tg = telegramWebApp();
  const data = tg?.initData;
  if (data && data.length > 0) return true;
  if (hasTgWebAppUrlMarker()) return true;
  const platform = tg?.platform;
  if (platform && platform !== 'unknown' && platform !== '') return true;
  return false;
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
    if (!tg && !hasTgWebAppUrlMarker()) return;
    WebApp.ready();
    WebApp.expand();
  } catch {
    try {
      const tg = telegramWebApp();
      tg?.ready?.();
      tg?.expand?.();
    } catch {
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
