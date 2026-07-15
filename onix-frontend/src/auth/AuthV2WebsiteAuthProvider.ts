import type {
  WebsiteAuthProvider,
  WebsiteAuthSessionSummary,
  WebsiteAuthUser,
} from './types';

/**
 * Phase A stub: Auth V2 provider surface.
 * Real memory token + cookie refresh + /api/v2/auth wiring lands in Phases B–D.
 * Calling mutating methods before Phase C must fail loudly in development.
 */
export class AuthV2WebsiteAuthProvider implements WebsiteAuthProvider {
  readonly mode = 'auth_v2' as const;

  getAccessToken(): string | null {
    return null;
  }

  async restoreSession(): Promise<boolean> {
    return false;
  }

  async loginWithTelegram(): Promise<void> {
    throw new Error('AuthV2WebsiteAuthProvider.loginWithTelegram is not implemented until Phase C.');
  }

  async logout(): Promise<void> {
    throw new Error('AuthV2WebsiteAuthProvider.logout is not implemented until Phase D.');
  }

  async logoutAll(): Promise<void> {
    throw new Error('AuthV2WebsiteAuthProvider.logoutAll is not implemented until Phase D.');
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
}
