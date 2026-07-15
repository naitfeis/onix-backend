import {
  clearAccessToken,
  getAccessToken,
  loginWithTelegram as legacyLoginWithTelegram,
} from '../api/client';
import type {
  WebsiteAuthProvider,
  WebsiteAuthSessionSummary,
  WebsiteAuthUser,
} from './types';

/**
 * Current production Website behaviour wrapped behind WebsiteAuthProvider.
 * Mini App bootstrap (/telegram-mini) stays outside this provider.
 */
export class LegacyWebsiteAuthProvider implements WebsiteAuthProvider {
  readonly mode = 'legacy' as const;

  getAccessToken(): string | null {
    return getAccessToken();
  }

  async restoreSession(): Promise<boolean> {
    return Boolean(this.getAccessToken());
  }

  async loginWithTelegram(payload: Record<string, string | number>): Promise<void> {
    await legacyLoginWithTelegram(payload);
  }

  async logout(): Promise<void> {
    clearAccessToken();
  }

  async logoutAll(): Promise<void> {
    await this.logout();
  }

  async getMe(): Promise<WebsiteAuthUser | null> {
    return null;
  }

  async listSessions(): Promise<WebsiteAuthSessionSummary[]> {
    return [];
  }

  async revokeSession(): Promise<void> {
    /* Legacy HS256 path has no server session list. */
  }
}
