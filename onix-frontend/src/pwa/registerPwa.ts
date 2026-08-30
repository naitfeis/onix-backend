import { registerSW } from 'virtual:pwa-register';

/** Registers the service worker. Skip inside Telegram Mini App (not a installable PWA surface). */
export function registerPwa(opts?: {
  onNeedRefresh?: (update: () => void) => void;
  onOfflineReady?: () => void;
}): void {
  if (typeof window === 'undefined') return;
  try {
    const tg = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
    if (tg?.initData) return;
  } catch {
    /* ignore */
  }

  try {
    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW(_swUrl, registration) {
        // Pull updates so stale SW (old auth interceptors) do not linger after deploy.
        // RU CF timeouts on sw.js must not surface as unhandledrejection.
        void registration?.update().catch(() => { /* offline / timed out */ });
      },
      onNeedRefresh() {
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
