import { AuthManager } from './AuthManager';
import { getSharedAuthManager } from './sharedAuthManager';
import type {
  WebsiteAuthProvider,
  WebsiteAuthSessionSummary,
  WebsiteAuthUser,
} from './types';

/**
 * Auth V2 Website provider — fully backed by AuthManager (Phase B).
 * Not activated by default (`VITE_WEBSITE_AUTH_MODE` defaults to legacy).
 * Login → /api/v2/auth/login remains Phase C (App.tsx still on Legacy).
 */
export class AuthV2WebsiteAuthProvider implements WebsiteAuthProvider {
  readonly mode = 'auth_v2' as const;
  private readonly manager: AuthManager;

  constructor(manager: AuthManager = getSharedAuthManager()) {
    this.manager = manager;
  }
  getAccessToken(): string | null {
    return this.manager.getAccessToken();
  }

  async restoreSession(): Promise<boolean> {
    return this.manager.restoreSession();
  }

  async loginWithTelegram(): Promise<void> {
    throw new Error('AuthV2WebsiteAuthProvider.loginWithTelegram is not implemented until Phase C.');
  }

  /** Local session clear + cross-tab logout. Server logout API lands in Phase D. */
  async logout(): Promise<void> {
    this.manager.clearSession('logout');
  }

  async logoutAll(): Promise<void> {
    this.manager.clearSession('logout');
  }

  async getMe(): Promise<WebsiteAuthUser | null> {
    return null;
  }

  async listSessions(): Promise<WebsiteAuthSessionSummary[]> {
    return [];
  }

  async revokeSession(): Promise<void> {
    throw new Error('AuthV2WebsiteAuthProvider.revokeSession is not implemented until Phase D.');
  }

  /** Expose manager for Phase B/C wiring tests — not used by Legacy App. */
  getAuthManager(): AuthManager {
    return this.manager;
  }
}
