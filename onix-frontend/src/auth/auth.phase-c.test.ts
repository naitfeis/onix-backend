import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthBroadcast } from './authBroadcast';
import { AuthManager } from './AuthManager';
import { AuthV2WebsiteAuthProvider } from './AuthV2WebsiteAuthProvider';
import { resetMemoryAccessTokenStore } from './memoryAccessToken';
import { normalizeTelegramLoginPayload } from './telegramPayload';
import { resetSharedAuthManager } from './sharedAuthManager';

vi.mock('@twa-dev/sdk', () => ({
  default: { initData: '' },
}));

const widgetPayload = {
  id: 42,
  first_name: 'Onix',
  username: 'onix_user',
  auth_date: 1_700_000_000,
  hash: 'a'.repeat(64),
};

function loginOk() {
  return {
    success: true,
    data: {
      accessToken: 'ed25519-access',
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshMaxAgeSeconds: 2_592_000,
      trustedDevice: false,
      user: {
        id: '7',
        onixId: 'ONIX7',
        isAdmin: false,
        sessionVersion: 0,
        permissionVersion: 0,
      },
      session: {
        id: 'sess-1',
        deviceName: null,
        browser: null,
        os: null,
        country: null,
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        rememberMe: false,
      },
    },
  };
}

function meOk() {
  return {
    success: true,
    data: {
      id: '7',
      onixId: 'ONIX7',
      isAdmin: false,
      sessionId: 'sess-1',
      sessionVersion: 0,
      permissionVersion: 0,
      roles: ['USER'],
      permissions: [],
    },
  };
}

describe('Phase C — Auth V2 Telegram login', () => {
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();

  beforeEach(() => {
    resetMemoryAccessTokenStore();
    resetSharedAuthManager();
    localStore.clear();
    sessionStore.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => localStore.get(key) ?? null,
      setItem: (key: string, value: string) => { localStore.set(key, value); },
      removeItem: (key: string) => { localStore.delete(key); },
      clear: () => localStore.clear(),
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => sessionStore.get(key) ?? null,
      setItem: (key: string, value: string) => { sessionStore.set(key, value); },
      removeItem: (key: string) => { sessionStore.delete(key); },
      clear: () => sessionStore.clear(),
    });
  });

  afterEach(() => {
    resetSharedAuthManager();
  });

  it('normalizes telegram id number → string for LoginDto', () => {
    const telegram = normalizeTelegramLoginPayload(widgetPayload);
    expect(telegram.id).toBe('42');
    expect(telegram.first_name).toBe('Onix');
    expect(telegram.hash).toHaveLength(64);
  });

  it('Telegram Login Success: login → me → authenticated', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (String(url).endsWith('/api/v2/auth/login')) {
        return {
          ok: true,
          status: 200,
          json: async () => loginOk(),
        } as Response;
      }
      if (String(url).endsWith('/api/v2/auth/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => meOk(),
        } as Response;
      }
      throw new Error(`unexpected ${url}`);
    });

    const manager = new AuthManager({
      refresh: async () => ({ accessToken: 'x', expiresIn: 900 }),
      broadcast: new AuthBroadcast('phase-c-ok', () => null),
    });
    const provider = new AuthV2WebsiteAuthProvider({ manager, fetchImpl, apiBase: '' });

    await provider.loginWithTelegram(widgetPayload);

    expect(calls.map((c) => c.url)).toEqual(['/api/v2/auth/login', '/api/v2/auth/me']);
    expect(calls[0]?.init?.credentials).toBe('include');
    expect(calls[0]?.init?.method).toBe('POST');
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.telegram.id).toBe('42');
    expect(calls[1]?.init?.headers).toBeTruthy();
    expect(new Headers(calls[1]?.init?.headers).get('Authorization')).toBe('Bearer ed25519-access');

    expect(provider.getAccessToken()).toBe('ed25519-access');
    const me = await provider.getMe();
    expect(me?.onixId).toBe('ONIX7');
    expect(localStore.size).toBe(0);
    expect(sessionStore.size).toBe(0);
    manager.dispose();
  });

  it('Login Failure: AuthManager empty and stable', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: { code: 'AUTH_PROVIDER_REJECTED', message: 'bad hash' },
      }),
    }) as Response);

    const manager = new AuthManager({
      refresh: async () => ({ accessToken: 'x', expiresIn: 900 }),
      broadcast: new AuthBroadcast('phase-c-fail', () => null),
    });
    const provider = new AuthV2WebsiteAuthProvider({ manager, fetchImpl, apiBase: '' });

    await expect(provider.loginWithTelegram(widgetPayload)).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_PROVIDER_REJECTED',
    });
    expect(provider.getAccessToken()).toBeNull();
    expect(await provider.getMe()).toBeNull();
    manager.dispose();
  });

  it('Me Failure: clears session → unauthenticated', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/v2/auth/login')) {
        return { ok: true, status: 200, json: async () => loginOk() } as Response;
      }
      return {
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: { code: 'AUTH_INVALID_TOKEN', message: 'me failed' },
        }),
      } as Response;
    });

    const manager = new AuthManager({
      refresh: async () => ({ accessToken: 'x', expiresIn: 900 }),
      broadcast: new AuthBroadcast('phase-c-me-fail', () => null),
    });
    const provider = new AuthV2WebsiteAuthProvider({ manager, fetchImpl, apiBase: '' });

    await expect(provider.loginWithTelegram(widgetPayload)).rejects.toMatchObject({ status: 401 });
    expect(provider.getAccessToken()).toBeNull();
    expect(await provider.getMe()).toBeNull();
    expect(sessionStore.size).toBe(0);
    manager.dispose();
  });

  it('Access Storage Audit after successful login', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/login')) {
        return { ok: true, status: 200, json: async () => loginOk() } as Response;
      }
      return { ok: true, status: 200, json: async () => meOk() } as Response;
    });
    const manager = new AuthManager({
      refresh: async () => ({ accessToken: 'x', expiresIn: 900 }),
      broadcast: new AuthBroadcast('phase-c-audit', () => null),
    });
    const provider = new AuthV2WebsiteAuthProvider({ manager, fetchImpl, apiBase: '' });
    await provider.loginWithTelegram(widgetPayload);

    expect([...localStore.values()]).not.toContain('ed25519-access');
    expect([...sessionStore.values()]).not.toContain('ed25519-access');
    expect(localStore.get('onix.accessToken')).toBeUndefined();
    expect(sessionStore.get('onix.accessToken')).toBeUndefined();
    manager.dispose();
  });

  it('Cookie Flow: login uses credentials include', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/login')) {
        return { ok: true, status: 200, json: async () => loginOk() } as Response;
      }
      return { ok: true, status: 200, json: async () => meOk() } as Response;
    });
    const manager = new AuthManager({
      refresh: async () => ({ accessToken: 'x', expiresIn: 900 }),
      broadcast: new AuthBroadcast('phase-c-cookie', () => null),
    });
    const provider = new AuthV2WebsiteAuthProvider({ manager, fetchImpl, apiBase: '' });
    await provider.loginWithTelegram(widgetPayload);
    const firstCall = fetchImpl.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    expect(firstCall?.[1]?.credentials).toBe('include');
    manager.dispose();
  });

  it('Logout clears AuthManager', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/login')) {
        return { ok: true, status: 200, json: async () => loginOk() } as Response;
      }
      return { ok: true, status: 200, json: async () => meOk() } as Response;
    });
    const manager = new AuthManager({
      refresh: async () => ({ accessToken: 'x', expiresIn: 900 }),
      broadcast: new AuthBroadcast('phase-c-logout', () => null),
    });
    const provider = new AuthV2WebsiteAuthProvider({ manager, fetchImpl, apiBase: '' });
    await provider.loginWithTelegram(widgetPayload);
    await provider.logout();
    expect(provider.getAccessToken()).toBeNull();
    expect(await provider.getMe()).toBeNull();
    manager.dispose();
  });

  it('Legacy Provider still uses /api/auth/telegram-login', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { accessToken: 'legacy-jwt', tokenType: 'Bearer' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VITE_API_URL', 'https://onix-api-47tj.onrender.com');
    vi.resetModules();

    const { LegacyWebsiteAuthProvider: Legacy } = await import('./LegacyWebsiteAuthProvider');
    const legacy = new Legacy();
    await legacy.loginWithTelegram(widgetPayload);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://onix-api-47tj.onrender.com/api/auth/telegram-login',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(sessionStore.get('onix.accessToken')).toBe('legacy-jwt');
  });
});

describe('Mini App Regression', () => {
  it('bootstrapAuth still posts /api/auth/telegram-mini and uses sessionStorage', async () => {
    const storage = new Map<string, string>();
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'https://onix-api-47tj.onrender.com');
    vi.doMock('@twa-dev/sdk', () => ({
      default: { initData: 'query_id=1&auth_date=1&user=%7B%22id%22%3A1%7D&hash=test' },
    }));
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { accessToken: 'mini-jwt', tokenType: 'Bearer' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { bootstrapAuth } = await import('../api/client');
    await expect(bootstrapAuth()).resolves.toBe(true);
    expect(storage.get('onix.accessToken')).toBe('mini-jwt');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://onix-api-47tj.onrender.com/api/auth/telegram-mini',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
