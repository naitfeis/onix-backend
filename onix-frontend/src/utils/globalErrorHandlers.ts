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

  // Telegram Mini App + visualViewport: keep modal overlay sized to the visible screen.
  const syncTelegramViewport = () => {
    try {
      const wa = (window as unknown as {
        Telegram?: { WebApp?: { viewportHeight?: number; viewportStableHeight?: number } };
      }).Telegram?.WebApp;
      const vv = window.visualViewport?.height;
      const h = wa?.viewportStableHeight ?? wa?.viewportHeight ?? vv ?? window.innerHeight;
      if (typeof h === 'number' && h > 0) {
        document.documentElement.style.setProperty('--tg-viewport-height', `${Math.round(h)}px`);
      }
    } catch {
      /* ignore */
    }
  };
  syncTelegramViewport();
  window.addEventListener('resize', syncTelegramViewport);
  window.visualViewport?.addEventListener('resize', syncTelegramViewport);
  window.visualViewport?.addEventListener('scroll', syncTelegramViewport);
  try {
    const wa = (window as unknown as {
      Telegram?: { WebApp?: { onEvent?: (event: string, cb: () => void) => void } };
    }).Telegram?.WebApp;
    wa?.onEvent?.('viewportChanged', syncTelegramViewport);
  } catch {
    /* ignore */
  }
}
