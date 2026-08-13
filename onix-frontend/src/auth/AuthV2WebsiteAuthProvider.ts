import { AuthManager } from './AuthManager';
import { collectDeviceInfoAsync } from './deviceInfo';
import { getSharedAuthManager } from './sharedAuthManager';
import { normalizeTelegramLoginPayload } from './telegramPayload';
import type {
  WebsiteAuthProvider,
  WebsiteAuthSessionSummary,
  WebsiteAuthUser,
} from './types';
import {
  AuthV2ApiError,
  getAuthV2Me,
  postAuthV2Login,
  postAuthV2Logout,
  type AuthV2Fetch,
  type AuthV2MeData,
} from './v2AuthApi';
import { isTransientRefreshFailure } from './refreshClient';
import { resolveApiBase } from './apiConfig';

export type AuthV2WebsiteAuthProviderOptions = {
  manager?: AuthManager;
  fetchImpl?: AuthV2Fetch;
  apiBase?: string;
};

/**
 * Auth V2 Website provider (Phase C login wired).
 * Default mode remains legacy via VITE_WEBSITE_AUTH_MODE — this provider activates only when mode=auth_v2.
 *
 * Login flow (mandatory):
 *   Widget → POST /api/v2/auth/login → setSession → GET /api/v2/auth/me
 *   If /me fails → clearSession → unauthenticated (no half-state).
 */
export class AuthV2WebsiteAuthProvider implements WebsiteAuthProvider {
  readonly mode = 'auth_v2' as const;
  private readonly manager: AuthManager;
  private readonly fetchImpl: AuthV2Fetch;
  private readonly apiBase: string;
  private cachedUser: WebsiteAuthUser | null = null;

  constructor(options: AuthV2WebsiteAuthProviderOptions | AuthManager = {}) {
    if (options instanceof AuthManager) {
      this.manager = options;
      this.fetchImpl = fetch;
      this.apiBase = resolveApiBase();
    } else {
      this.manager = options.manager ?? getSharedAuthManager();
      this.fetchImpl = options.fetchImpl ?? fetch;
      this.apiBase = options.apiBase ?? resolveApiBase();
    }
  }

  getAccessToken(): string | null {
    return this.manager.getAccessToken();
  }

  async restoreSession(): Promise<boolean> {
    // Authoritative path only: refresh cookie → access → /me.
    // Do not call /api/session-probe (disabled in production → 404 → false network → races).
    try {
      const restored = await this.manager.restoreSession();
      if (!restored) {
        this.cachedUser = null;
        return false;
      }
      const me = await this.fetchMeOrThrow();
      this.cachedUser = toWebsiteUser(me);
      return true;
    } catch (error) {
      if (isTransientRefreshFailure(error) || (error instanceof AuthV2ApiError && error.status >= 500)) {
        this.cachedUser = null;
        return Boolean(this.manager.getAccessToken());
      }
      this.manager.clearSession('force-reauth');
      this.cachedUser = null;
      return false;
    }
  }

  async loginWithTelegram(
    payload: Record<string, string | number>,
    options?: { rememberMe?: boolean },
  ): Promise<void> {
    const telegram = normalizeTelegramLoginPayload(payload);
    const login = await postAuthV2Login(
      {
        telegram,
        // Website persistent session by default (survive browser close / next-day return).
        rememberMe: options?.rememberMe !== false,
        device: await collectDeviceInfoAsync(),
      },
      this.fetchImpl,
      this.apiBase,
    );

    this.manager.setSession(login.accessToken, login.expiresIn);

    try {
      const me = await this.fetchMeOrThrow();
      this.cachedUser = toWebsiteUser(me);
    } catch (error) {
      this.manager.clearSession('force-reauth');
      this.cachedUser = null;
      throw error;
    }
  }

  async logout(): Promise<void> {
    this.cachedUser = null;
    try {
      let token = this.manager.getAccessToken();
      if (!token || this.manager.isAccessExpired()) {
        try {
          token = await this.manager.refreshAccessToken();
        } catch {
          token = this.manager.getAccessToken();
        }
      }
      if (token) {
        await postAuthV2Logout(token, this.fetchImpl, this.apiBase);
      }
    } catch {
      // Best-effort: still clear local session / cookie may already be gone.
    } finally {
      this.manager.clearSession('logout');
    }
  }

  async logoutAll(): Promise<void> {
    await this.logout();
  }

  async getMe(): Promise<WebsiteAuthUser | null> {
    if (this.cachedUser) return this.cachedUser;
    const token = this.manager.getAccessToken();
    if (!token) return null;
    try {
      const me = await this.fetchMeOrThrow();
      this.cachedUser = toWebsiteUser(me);
      return this.cachedUser;
    } catch (error) {
      if (isTransientRefreshFailure(error) || (error instanceof AuthV2ApiError && error.status >= 500)) {
        return null;
      }
      this.manager.clearSession('force-reauth');
      this.cachedUser = null;
      return null;
    }
  }

  async listSessions(): Promise<WebsiteAuthSessionSummary[]> {
    return [];
  }

  async revokeSession(): Promise<void> {
    throw new Error('AuthV2WebsiteAuthProvider.revokeSession is not implemented until Phase D.');
  }

  getAuthManager(): AuthManager {
    return this.manager;
  }

  private async fetchMeOrThrow(): Promise<AuthV2MeData> {
    const token = this.manager.getAccessToken();
    if (!token) {
      throw new AuthV2ApiError('Missing access token before /me.', 401, 'AUTH_INVALID_TOKEN');
    }
    return getAuthV2Me(token, this.fetchImpl, this.apiBase);
  }
}

function toWebsiteUser(me: AuthV2MeData): WebsiteAuthUser {
  return {
    id: me.id,
    onixId: me.onixId,
    isAdmin: me.isAdmin,
    sessionId: me.sessionId,
    sessionVersion: me.sessionVersion,
    permissionVersion: me.permissionVersion,
  };
}
