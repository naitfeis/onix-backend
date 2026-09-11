import { registerSW } from 'virtual:pwa-register';

/** Registers the service worker. Skip inside Telegram Mini App (not a installable PWA surface). */
export function registerPwa(opts?: {
  onNeedRefresh?: (update: () => void) => void;
  onOfflineReady?: () => void;
}): void {
  if (typeof window === 'undefined') return;
  const skipPwa = (): boolean => {
    try {
      const tg = (window as Window & {
        Telegram?: { WebApp?: { initData?: string } };
        TelegramWebviewProxy?: unknown;
      }).Telegram?.WebApp;
      const hash = typeof location !== 'undefined' ? location.hash : '';
      const search = typeof location !== 'undefined' ? location.search : '';
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      return Boolean(tg)
        || Boolean((window as Window & { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy)
        || /Telegram/i.test(ua)
        || hash.includes('tgWebAppData')
        || hash.includes('tgWebAppStartParam')
        || search.includes('tgWebAppData')
        || search.includes('tgWebAppStartParam');
    } catch {
      return false;
    }
  };

  const unregisterSw = () => {
    void navigator.serviceWorker?.getRegistrations?.()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => undefined);
  };

  if (skipPwa()) {
    unregisterSw();
    return;
  }

  // Telegram inject can land after first JS tick — do not let skipWaiting reload the WebView.
  window.setTimeout(() => {
    if (skipPwa()) {
      unregisterSw();
      return;
    }
    registerWebsitePwa(opts);
  }, 400);
}

function registerWebsitePwa(opts?: {
  onNeedRefresh?: (update: () => void) => void;
  onOfflineReady?: () => void;
}): void {
  try {
    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW(_swUrl, registration) {
        // Pull updates so stale SW (old auth interceptors) do not linger after deploy.
        // RU CF timeouts on sw.js must not surface as unhandledrejection.
        void registration?.update().catch(() => { /* offline / timed out */ });
      },
      onNeedRefresh() {
        // Never auto-reload — that looked like the site "refreshing 2–3 times" on entry.
        // Offer update only when the host UI passes a banner handler.
        opts?.onNeedRefresh?.(() => {
          void Promise.resolve(updateSW(true)).catch(() => { /* ignore */ });
        });
      },
      onOfflineReady() {
        opts?.onOfflineReady?.();
      },
    });
  } catch {
    /* SW unsupported or blocked — app still works online */
  }
}
