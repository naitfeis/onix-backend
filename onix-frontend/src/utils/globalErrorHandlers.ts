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
}
