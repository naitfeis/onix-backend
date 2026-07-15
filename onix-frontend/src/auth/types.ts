/**
 * Website auth surface modes for the cutover window.
 *
 * - legacy  — Telegram Widget → /api/auth/telegram-login → sessionStorage JWT
 * - auth_v2 — Telegram Widget → /api/v2/auth/* → memory access + HttpOnly refresh
 *
 * After Auth V2 soak, legacy is removed and this union collapses to auth_v2 only.
 */
export type WebsiteAuthMode = 'legacy' | 'auth_v2';

export type WebsiteAuthUser = {
  id: string;
  onixId: string;
  isAdmin?: boolean;
  sessionId?: string;
  sessionVersion?: number;
  permissionVersion?: number;
};

export type WebsiteAuthSessionSummary = {
  id: string;
  deviceName?: string | null;
  browser?: string | null;
  os?: string | null;
  country?: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
  rememberMe: boolean;
  current?: boolean;
};

/**
 * Contract implemented by Legacy and AuthV2 providers.
 * Phase A ships the interface + mode switch only; concrete AuthV2 methods land in B–D.
 */
export interface WebsiteAuthProvider {
  readonly mode: WebsiteAuthMode;
  getAccessToken(): string | null;
  /** Website bootstrap after reload (cookie refresh / legacy storage). */
  restoreSession(): Promise<boolean>;
  loginWithTelegram(payload: Record<string, string | number>, options?: { rememberMe?: boolean }): Promise<void>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
  getMe(): Promise<WebsiteAuthUser | null>;
  listSessions(): Promise<WebsiteAuthSessionSummary[]>;
  revokeSession(sessionId: string): Promise<void>;
}
