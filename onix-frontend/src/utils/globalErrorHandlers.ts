/** Log Mini App freezes / uncaught errors without crashing the shell. */
export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __onixErrorHandlersInstalled?: boolean };
  if (w.__onixErrorHandlersInstalled) return;
  w.__onixErrorHandlersInstalled = true;

  window.addEventListener('error', (event) => {
    console.error('[ONIX] window.onerror', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[ONIX] unhandledrejection', event.reason);
  });

  // Telegram / visualViewport height for modal overlay — rAF-throttled, no scroll listener.
  let lastH = 0;
  let raf = 0;
  const syncTelegramViewport = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      try {
        const wa = (window as unknown as {
          Telegram?: { WebApp?: { viewportHeight?: number; viewportStableHeight?: number } };
        }).Telegram?.WebApp;
        const h = wa?.viewportStableHeight
          ?? wa?.viewportHeight
          ?? window.visualViewport?.height
          ?? window.innerHeight;
        const rounded = typeof h === 'number' && h > 0 ? Math.round(h) : 0;
        if (rounded > 0 && rounded !== lastH) {
          lastH = rounded;
          document.documentElement.style.setProperty('--tg-viewport-height', `${rounded}px`);
        }
      } catch {
        /* ignore */
      }
    });
  };
  syncTelegramViewport();
  window.addEventListener('resize', syncTelegramViewport, { passive: true });
  window.visualViewport?.addEventListener('resize', syncTelegramViewport, { passive: true });
  try {
    const wa = (window as unknown as {
      Telegram?: { WebApp?: { onEvent?: (event: string, cb: () => void) => void } };
    }).Telegram?.WebApp;
    wa?.onEvent?.('viewportChanged', syncTelegramViewport);
  } catch {
    /* ignore */
  }
}
