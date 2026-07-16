/**
 * Telegram environment helpers without importing @twa-dev/sdk.
 * Website path must never hard-depend on the Telegram SDK bundle.
 */

type TelegramWebAppLike = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  HapticFeedback?: {
    notificationOccurred?: (kind: 'success' | 'error' | 'warning') => void;
    impactOccurred?: (style: string) => void;
  };
};

function telegramWebApp(): TelegramWebAppLike | undefined {
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

/** True only when Telegram injected Mini App initData (not ordinary www). */
export function isTelegramMiniApp(): boolean {
  const data = telegramWebApp()?.initData;
  return Boolean(data && data.length > 0);
}

export function getTelegramInitData(): string {
  return telegramWebApp()?.initData ?? '';
}

/** No-op on ordinary web — never blocks bootstrap. */
export function signalTelegramReadyIfMiniApp(): void {
  if (!isTelegramMiniApp()) return;
  try {
    const tg = telegramWebApp();
    tg?.ready?.();
    tg?.expand?.();
  } catch {
    /* ignore */
  }
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
