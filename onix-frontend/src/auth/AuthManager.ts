import { AuthBroadcast, type AuthBroadcastEvent } from './authBroadcast';
import {
  clearMemoryAccessToken,
  readMemoryAccessToken,
  writeMemoryAccessToken,
} from './memoryAccessToken';
import { postAuthV2Refresh, RefreshError, isDefinitiveAuthRefreshFailure, type RefreshTransport } from './refreshClient';

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
 *
 * Lifecycle (no hidden loops):
 *   Unauthenticated ──restore/login──► Authenticated
 *        ▲                                 │
 *        │                    ┌────────────┼────────────┐
 *        │                    │            │            │
 *        │             proactive      API 401      explicit logout
 *        │                    │            │            │
 *        │                    ▼            ▼            │
 *        │               Refreshing ◄──────┘            │
 *        │               /         \                    │
 *        │          success       failure               │
 *        │               │           │                  │
 *        │               ▼           └──────► LoggedOut ◄┘
 *        │          Authenticated
 *        └────────────(clear)─────────────────────┘
 *
 * Concurrent callers share one `refreshInFlight` promise (refresh queue).
 * Logout / dispose bumps `sessionGeneration` so a late refresh cannot restore tokens.
 */
export class AuthManager {
  private expiresAtMs: number | null = null;
  private refreshInFlight: Promise<string> | null = null;
  /** Cookie missing/rejected — do not keep POSTing /refresh or wipe a live access token. */
  private refreshCookieGone = false;
  private proactiveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeBroadcast: (() => void) | null = null;
  private disposed = false;
  /** Bumped on clearSession/dispose so in-flight refresh results are discarded. */
  private sessionGeneration = 0;
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

  /** Test/ops helper — current logout/dispose generation. */
  getSessionGeneration(): number {
    return this.sessionGeneration;
  }

  isAccessExpired(skewMs = 0): boolean {
    if (!this.getAccessToken()) return true;
    // Token in memory without a known expiry is still usable until an API 401.
    if (this.expiresAtMs == null) return false;
    return this.now() + skewMs >= this.expiresAtMs;
  }

  /**
   * Store access in memory and schedule proactive refresh.
   * Never writes localStorage / sessionStorage.
   */
  setSession(accessToken: string, expiresInSeconds: number, options?: { broadcast?: boolean }): void {
    this.assertOpen();
    this.refreshCookieGone = false;
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
    this.sessionGeneration += 1;
    if (reason !== 'refresh-failed') this.refreshCookieGone = false;
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
   * Example: refresh takes 8s and 30 callers arrive → still exactly 1 HTTP refresh;
   * all 30 await the same promise, then continue with the new access token.
   */
  refreshAccessToken(): Promise<string> {
    this.assertOpen();
    if (this.refreshCookieGone) {
      return Promise.reject(new RefreshError(
        'Refresh cookie is missing.',
        401,
        'AUTH_REFRESH_MISSING',
      ));
    }
    if (this.refreshInFlight) return this.refreshInFlight;

    const generation = this.sessionGeneration;
    this.refreshInFlight = (async () => {
      try {
        const result = await this.refreshFn();
        if (this.disposed || generation !== this.sessionGeneration) {
          throw new RefreshError(
            'Session was cleared during refresh.',
            401,
            'AUTH_SESSION_CLEARED',
          );
        }
        this.setSession(result.accessToken, result.expiresIn);
        return result.accessToken;
      } catch (error) {
        // Only logout when the server rejects the cookie/session.
        // Network timeouts / 5xx must NOT clearSession — HttpOnly cookie remains valid.
        if (
          generation === this.sessionGeneration
          && !this.disposed
          && isDefinitiveAuthRefreshFailure(error)
        ) {
          // Multi-tab race: peer may have won refresh and broadcast token-updated.
          if (isRefreshRaceCandidate(error)) {
            const peerToken = await this.waitForPeerAccessToken(450);
            if (peerToken && generation === this.sessionGeneration && !this.disposed) {
              return peerToken;
            }
          }
          if (generation === this.sessionGeneration && !this.disposed) {
            const live = this.getAccessToken();
            if (live && !this.isAccessExpired(0)) {
              this.refreshCookieGone = true;
              this.clearProactiveTimer();
            } else {
              this.clearSession('refresh-failed');
              this.refreshCookieGone = true;
            }
          }
        }
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
    if (this.refreshCookieGone) return this.getAccessToken();
    try {
      return await this.refreshAccessToken();
    } catch {
      return this.getAccessToken();
    }
  }

  /**
   * Silent restore after full page reload (F5): no token in memory → refresh cookie.
   * Transient network failures return false without wiping session cookie / peer tabs.
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
      if (this.refreshCookieGone) throw error;
      const fresh = await this.refreshAccessToken();
      return execute(fresh);
    }
  }

  /**
   * Tab teardown: cancel proactive timer, unsubscribe, close BroadcastChannel.
   * Shared singleton registers `pagehide` → dispose (see sharedAuthManager).
   */
  dispose(): void {
    if (this.disposed) return;
    this.sessionGeneration += 1;
    this.disposed = true;
    clearMemoryAccessToken();
    this.expiresAtMs = null;
    this.clearProactiveTimer();
    this.unsubscribeBroadcast?.();
    this.unsubscribeBroadcast = null;
    this.broadcast.close();
    this.refreshInFlight = null;
  }

  private onBroadcast(event: AuthBroadcastEvent): void {
    if (this.disposed) return;
    if (event.type === 'logout' || event.type === 'force-reauth') {
      // Peer logout: invalidate local session without re-broadcasting.
      this.sessionGeneration += 1;
      clearMemoryAccessToken();
      this.expiresAtMs = null;
      this.clearProactiveTimer();
      return;
    }
    if (event.type === 'token-updated') {
      this.applyingRemoteUpdate = true;
      try {
        this.refreshCookieGone = false;
        writeMemoryAccessToken(event.accessToken);
        this.expiresAtMs = event.expiresAtMs;
        this.scheduleProactiveRefresh();
      } finally {
        this.applyingRemoteUpdate = false;
      }
    }
  }

  /** Await peer BroadcastChannel token-updated (concurrent refresh loser). */
  private waitForPeerAccessToken(timeoutMs: number): Promise<string | null> {
    if (this.getAccessToken() && !this.isAccessExpired()) {
      return Promise.resolve(this.getAccessToken());
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsub();
        resolve(null);
      }, timeoutMs);
      const unsub = this.broadcast.subscribe((event) => {
        if (event.type !== 'token-updated') return;
        clearTimeout(timer);
        unsub();
        resolve(event.accessToken);
      });
    });
  }

  /**
   * delay = max(minProactiveIntervalMs, expiresAtMs - now - proactiveSkewMs)
   * Each setSession/token-updated first clearTimeout(previous), then schedules one new timer.
   */
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
        /* definitive auth failure clears inside refreshAccessToken; transient is ignored */
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

/** Failures that often mean "sibling tab won the refresh race", not true logout. */
function isRefreshRaceCandidate(error: unknown): boolean {
  if (!(error instanceof RefreshError)) return false;
  const code = error.code ?? '';
  return code === 'AUTH_REFRESH_REUSED' || code === 'AUTH_INVALID_TOKEN';
}
