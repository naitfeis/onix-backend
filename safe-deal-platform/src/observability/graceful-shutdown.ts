import { structuredLog } from './structured-logger';

export type ShutdownAble = {
  close: () => Promise<void>;
};

export type ShutdownOptions = {
  /** Max time to wait for in-flight work before force-close. Default 25s (Render ~30s SIGTERM). */
  timeoutMs?: number;
  /** Label for logs (api | worker). */
  role?: string;
};

/**
 * Registers SIGTERM/SIGINT handlers that:
 * 1) stop accepting new work
 * 2) await Nest close / destroy hooks
 * 3) force-exit after timeout
 */
export function registerGracefulShutdown(app: ShutdownAble, opts: ShutdownOptions = {}): void {
  const timeoutMs = opts.timeoutMs ?? Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000);
  const role = opts.role ?? 'api';
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    structuredLog.info('graceful shutdown started', { signal, role, timeoutMs });

    const force = setTimeout(() => {
      structuredLog.error('graceful shutdown timed out — forcing exit', { role, timeoutMs });
      process.exit(1);
    }, Number.isFinite(timeoutMs) ? timeoutMs : 25_000);
    force.unref?.();

    try {
      await app.close();
      structuredLog.info('graceful shutdown complete', { signal, role });
      clearTimeout(force);
      process.exit(0);
    } catch (err) {
      structuredLog.error('graceful shutdown failed', { role }, err);
      clearTimeout(force);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}
