import { AuthBroadcast, type AuthBroadcastEvent } from './authBroadcast';
import {
  clearMemoryAccessToken,
  readMemoryAccessToken,
  writeMemoryAccessToken,
} from './memoryAccessToken';
import { postAuthV2Refresh, RefreshError, type RefreshTransport } from './refreshClient';

export type AuthManagerOptions = {
  /** Override refresh HTTP (tests / mocks). Default: real /api/v2/auth/refresh. */
  refresh?: () => Promise<{ accessToken: string; expiresIn: number }>;
  transport?: RefreshTransport;
  broadcast?: AuthBroadcast;
  now?: () => number;
  /** Refresh this many ms before expiry. Default 60s. */
  proactiveSkewMs?: number;
  /** Minimum gap between proactive refresh schedules. */
  minProactiveIntervalMs?: number;
};

/**
 * Website Auth V2 client core (Phase B).
 * - Access JWT: memory only
 * - Refresh: HttpOnly cookie via /api/v2/auth/refresh + single-flight queue
 * - Cross-tab: BroadcastChannel
 *
 * Not wired into Legacy App login in Phase B — AuthV2 provider holds it inactive by default.
 */
export class AuthManager {
  private expiresAtMs: number | null = null;
  private refreshInFlight: Promise<string> | null = null;
  private proactiveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeBroadcast: (() => void) | null = null;
  private disposed = false;
  private readonly broadcast: AuthBroadcast;
  private readonly now: () => number;
  private readonly proactiveSkewMs: number;
  private readonly minProactiveIntervalMs: number;
  private readonly refreshFn: () => Promise<{ accessToken: string; expiresIn: number }>;
  private applyingRemoteUpdate = false;

  constructor(options: AuthManagerOptions = {}) {
    this.broadcast = options.broadcast ?? new AuthBroadcast();
    this.now = options.now ?? (() => Date.now());
    this.proactiveSkewMs = options.proactiveSkewMs ?? 60_000;
    this.minProactiveIntervalMs = options.minProactiveIntervalMs ?? 5_000;
    this.refreshFn = options.refresh ?? (() => postAuthV2Refresh(options.transport));
    this.unsubscribeBroadcast = this.broadcast.subscribe((event) => this.onBroadcast(event));
  }

  getAccessToken(): string | null {
    return readMemoryAccessToken();
  }

  getExpiresAtMs(): number | null {
    return this.expiresAtMs;
  }

  isAccessExpired(skewMs = 0): boolean {
    if (!this.getAccessToken() || this.expiresAtMs == null) return true;
    return this.now() + skewMs >= this.expiresAtMs;
  }

  /**
   * Store access in memory and schedule proactive refresh.
   * Never writes localStorage / sessionStorage.
   */
  setSession(accessToken: string, expiresInSeconds: number, options?: { broadcast?: boolean }): void {
    this.assertOpen();
    writeMemoryAccessToken(accessToken);
    this.expiresAtMs = this.now() + Math.max(1, expiresInSeconds) * 1000;
    this.scheduleProactiveRefresh();
    if (options?.broadcast !== false && !this.applyingRemoteUpdate) {
      this.broadcast.publish({
        type: 'token-updated',
        accessToken,
        expiresAtMs: this.expiresAtMs,
      });
    }
  }

  clearSession(reason: 'logout' | 'force-reauth' | 'refresh-failed' = 'logout'): void {
    clearMemoryAccessToken();
    this.expiresAtMs = null;
    this.clearProactiveTimer();
    if (this.disposed) return;
    if (reason === 'force-reauth' || reason === 'refresh-failed') {
      this.broadcast.publish({ type: 'force-reauth', reason });
    } else {
      this.broadcast.publish({ type: 'logout' });
    }
  }

  /**
   * Single-flight refresh. Concurrent callers share one in-flight promise (refresh queue).
   */
  refreshAccessToken(): Promise<string> {
    this.assertOpen();
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      try {
        const result = await this.refreshFn();
        this.setSession(result.accessToken, result.expiresIn);
        return result.accessToken;
      } catch (error) {
        this.clearSession(isMissingRefresh(error) || isUnauthorizedRefresh(error)
          ? 'refresh-failed'
          : 'refresh-failed');
        throw error;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  /** Return a valid access token, refreshing if missing/expired. */
  async ensureAccessToken(): Promise<string | null> {
    this.assertOpen();
    if (!this.isAccessExpired(0) && this.getAccessToken()) {
      return this.getAccessToken();
    }
    try {
      return await this.refreshAccessToken();
    } catch {
      return null;
    }
  }

  /**
   * Silent restore after full page reload (F5): no token in memory → refresh cookie.
   */
  async restoreSession(): Promise<boolean> {
    this.assertOpen();
    if (this.getAccessToken() && !this.isAccessExpired()) return true;
    try {
      await this.refreshAccessToken();
      return Boolean(this.getAccessToken());
    } catch {
      return false;
    }
  }

  /**
   * Execute with Bearer access; on 401 run exactly one refresh then one retry.
   * Concurrent 401s collapse into a single refresh via refreshAccessToken().
   */
  async withAccessToken<T>(execute: (accessToken: string) => Promise<T>): Promise<T> {
    const token = await this.ensureAccessToken();
    if (!token) {
      throw new RefreshError('No access token available.', 401, 'AUTH_REFRESH_MISSING');
    }

    try {
      return await execute(token);
    } catch (error) {
      if (!isUnauthorizedStatus(error)) throw error;
      const fresh = await this.refreshAccessToken();
      return execute(fresh);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearProactiveTimer();
    this.unsubscribeBroadcast?.();
    this.unsubscribeBroadcast = null;
    this.broadcast.close();
    this.refreshInFlight = null;
  }

  private onBroadcast(event: AuthBroadcastEvent): void {
    if (this.disposed) return;
    if (event.type === 'logout' || event.type === 'force-reauth') {
      clearMemoryAccessToken();
      this.expiresAtMs = null;
      this.clearProactiveTimer();
      return;
    }
    if (event.type === 'token-updated') {
      this.applyingRemoteUpdate = true;
      try {
        writeMemoryAccessToken(event.accessToken);
        this.expiresAtMs = event.expiresAtMs;
        this.scheduleProactiveRefresh();
      } finally {
        this.applyingRemoteUpdate = false;
      }
    }
  }

  private scheduleProactiveRefresh(): void {
    this.clearProactiveTimer();
    if (this.expiresAtMs == null) return;

    const delay = Math.max(
      this.minProactiveIntervalMs,
      this.expiresAtMs - this.now() - this.proactiveSkewMs,
    );

    this.proactiveTimer = setTimeout(() => {
      this.proactiveTimer = null;
      if (this.disposed) return;
      if (!this.getAccessToken()) return;
      void this.refreshAccessToken().catch(() => {
        /* clearSession already invoked inside refreshAccessToken */
      });
    }, delay);
  }

  private clearProactiveTimer(): void {
    if (this.proactiveTimer != null) {
      clearTimeout(this.proactiveTimer);
      this.proactiveTimer = null;
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('AuthManager is disposed.');
  }
}

function isUnauthorizedStatus(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'status' in error
    && Number((error as { status: unknown }).status) === 401,
  );
}

function isUnauthorizedRefresh(error: unknown): boolean {
  return error instanceof RefreshError && error.status === 401;
}

function isMissingRefresh(error: unknown): boolean {
  return error instanceof RefreshError
    && (error.code === 'AUTH_REFRESH_MISSING' || error.status === 401);
}
