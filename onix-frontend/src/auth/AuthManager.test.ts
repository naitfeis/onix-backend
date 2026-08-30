import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthManager } from './AuthManager';
import { AuthBroadcast, MemoryAuthBroadcastBus } from './authBroadcast';
import { resetMemoryAccessTokenStore } from './memoryAccessToken';
import { postAuthV2Refresh, RefreshError } from './refreshClient';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('AuthManager Phase B', () => {
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();

  beforeEach(() => {
    resetMemoryAccessTokenStore();
    localStore.clear();
    sessionStore.clear();
    vi.stubEnv('VITE_API_URL', '');
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('stores access token in memory only (storage audit)', () => {
    const manager = new AuthManager({
      refresh: async () => ({ accessToken: 'x', expiresIn: 900 }),
      broadcast: new AuthBroadcast('test-storage', () => null),
    });

    manager.setSession('memory-only-token', 900);

    expect(manager.getAccessToken()).toBe('memory-only-token');
    expect(localStore.size).toBe(0);
    expect(sessionStore.size).toBe(0);
    expect([...localStore.values()]).not.toContain('memory-only-token');
    expect([...sessionStore.values()]).not.toContain('memory-only-token');

    manager.dispose();
  });

  it('refresh storm: 20 parallel callers trigger exactly one refresh', async () => {
    let refreshCalls = 0;
    const manager = new AuthManager({
      refresh: async () => {
        refreshCalls += 1;
        await Promise.resolve();
        return { accessToken: `token-${refreshCalls}`, expiresIn: 900 };
      },
      broadcast: new AuthBroadcast('test-storm', () => null),
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => manager.refreshAccessToken()),
    );

    expect(refreshCalls).toBe(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe('token-1');
    expect(manager.getAccessToken()).toBe('token-1');
    manager.dispose();
  });

  it('401 → refresh → retry → success', async () => {
    let refreshCalls = 0;
    let attempts = 0;
    const manager = new AuthManager({
      refresh: async () => {
        refreshCalls += 1;
        return { accessToken: `fresh-${refreshCalls}`, expiresIn: 900 };
      },
      broadcast: new AuthBroadcast('test-401-ok', () => null),
    });

    // Valid in-memory access; API still returns 401 once (expired server-side).
    manager.setSession('still-valid', 900);

    const value = await manager.withAccessToken(async (token) => {
      attempts += 1;
      if (attempts === 1) {
        expect(token).toBe('still-valid');
        throw Object.assign(new Error('expired'), { status: 401 });
      }
      return `ok:${token}`;
    });

    expect(value).toBe('ok:fresh-1');
    expect(refreshCalls).toBe(1);
    expect(attempts).toBe(2);
    manager.dispose();
  });

  it('refresh storm under withAccessToken: 20 parallel expired calls → one ensure refresh', async () => {
    let refreshCalls = 0;
    const now = { t: 0 };
    const manager = new AuthManager({
      now: () => now.t,
      refresh: async () => {
        refreshCalls += 1;
        await Promise.resolve();
        return { accessToken: 'storm-token', expiresIn: 900 };
      },
      broadcast: new AuthBroadcast('test-storm-401', () => null),
    });

    manager.setSession('old', 10);
    now.t = 20_000;

    const results = await Promise.all(
      Array.from({ length: 20 }, () => manager.withAccessToken(async (token) => token)),
    );

    expect(refreshCalls).toBe(1);
    expect(results.every((token) => token === 'storm-token')).toBe(true);
    manager.dispose();
  });

  it('401 → refresh 401 → logout / no loops', async () => {
    let refreshCalls = 0;
    const manager = new AuthManager({
      refresh: async () => {
        refreshCalls += 1;
        throw new RefreshError('Refresh cookie is missing.', 401, 'AUTH_REFRESH_MISSING');
      },
      broadcast: new AuthBroadcast('test-401-fail', () => null),
    });

    await expect(manager.withAccessToken(async () => 'x')).rejects.toBeInstanceOf(RefreshError);
    expect(refreshCalls).toBe(1);
    expect(manager.getAccessToken()).toBeNull();

    await expect(manager.withAccessToken(async () => 'x')).rejects.toBeInstanceOf(RefreshError);
    expect(refreshCalls).toBe(1);
    expect(manager.getAccessToken()).toBeNull();
    manager.dispose();
  });

  it('network timeout on refresh does NOT logout (cookie may still be valid)', async () => {
    const manager = new AuthManager({
      refresh: async () => {
        throw new RefreshError('aborted', 0, 'AUTH_NETWORK_TRANSIENT');
      },
      broadcast: new AuthBroadcast('test-net', () => null),
    });
    manager.setSession('still-here', 900, { broadcast: false });
    await expect(manager.refreshAccessToken()).rejects.toMatchObject({ code: 'AUTH_NETWORK_TRANSIENT' });
    expect(manager.getAccessToken()).toBe('still-here');
    manager.dispose();
  });

  it('missing cookie → clear session and no inner refresh loop', async () => {
    let refreshCalls = 0;
    const manager = new AuthManager({
      refresh: async () => {
        refreshCalls += 1;
        throw new RefreshError('Refresh cookie is missing.', 401, 'AUTH_REFRESH_MISSING');
      },
      broadcast: new AuthBroadcast('test-missing', () => null),
    });

    await expect(manager.refreshAccessToken()).rejects.toMatchObject({
      code: 'AUTH_REFRESH_MISSING',
      status: 401,
    });
    expect(refreshCalls).toBe(1);
    expect(manager.getAccessToken()).toBeNull();
    manager.dispose();
  });

  it('keeps a live access token when refresh cookie is missing', async () => {
    let refreshCalls = 0;
    const manager = new AuthManager({
      refresh: async () => {
        refreshCalls += 1;
        throw new RefreshError('Refresh cookie is missing.', 401, 'AUTH_REFRESH_MISSING');
      },
      broadcast: new AuthBroadcast('test-keep-live', () => null),
    });
    manager.setSession('live-access', 900, { broadcast: false });
    await expect(manager.refreshAccessToken()).rejects.toMatchObject({ code: 'AUTH_REFRESH_MISSING' });
    expect(manager.getAccessToken()).toBe('live-access');
    await expect(manager.refreshAccessToken()).rejects.toMatchObject({ code: 'AUTH_REFRESH_MISSING' });
    expect(refreshCalls).toBe(1);
    expect(await manager.ensureAccessToken()).toBe('live-access');
    manager.dispose();
  });

  it('Broadcast logout: tab A logout clears tab B', () => {
    const bus = new MemoryAuthBroadcastBus();
    const tabA = new AuthManager({
      refresh: async () => ({ accessToken: 'a', expiresIn: 900 }),
      broadcast: new AuthBroadcast('onix-logout', (name) => bus.create(name)),
    });
    const tabB = new AuthManager({
      refresh: async () => ({ accessToken: 'b', expiresIn: 900 }),
      broadcast: new AuthBroadcast('onix-logout', (name) => bus.create(name)),
    });

    tabA.setSession('shared-token', 900, { broadcast: false });
    tabB.setSession('shared-token', 900, { broadcast: false });
    expect(tabB.getAccessToken()).toBe('shared-token');

    tabA.clearSession('logout');
    expect(tabA.getAccessToken()).toBeNull();
    expect(tabB.getAccessToken()).toBeNull();

    tabA.dispose();
    tabB.dispose();
  });

  it('Broadcast token-updated: refresh on A updates B without second refresh', async () => {
    const bus = new MemoryAuthBroadcastBus();
    let refreshA = 0;
    let refreshB = 0;
    const tabA = new AuthManager({
      refresh: async () => {
        refreshA += 1;
        return { accessToken: 'from-a', expiresIn: 900 };
      },
      broadcast: new AuthBroadcast('onix-token', (name) => bus.create(name)),
    });
    const tabB = new AuthManager({
      refresh: async () => {
        refreshB += 1;
        return { accessToken: 'from-b', expiresIn: 900 };
      },
      broadcast: new AuthBroadcast('onix-token', (name) => bus.create(name)),
    });

    await tabA.refreshAccessToken();
    expect(refreshA).toBe(1);
    expect(refreshB).toBe(0);
    expect(tabA.getAccessToken()).toBe('from-a');
    expect(tabB.getAccessToken()).toBe('from-a');

    tabA.dispose();
    tabB.dispose();
  });

  it('silent refresh after reload restores session', async () => {
    let refreshCalls = 0;
    const manager = new AuthManager({
      refresh: async () => {
        refreshCalls += 1;
        return { accessToken: 'restored', expiresIn: 900 };
      },
      broadcast: new AuthBroadcast('test-restore', () => null),
    });

    expect(manager.getAccessToken()).toBeNull();
    await expect(manager.restoreSession()).resolves.toBe(true);
    expect(refreshCalls).toBe(1);
    expect(manager.getAccessToken()).toBe('restored');
    manager.dispose();
  });

  it('proactive refresh fires once near expiry without loops', async () => {
    let refreshCalls = 0;
    const now = { t: 0 };
    const manager = new AuthManager({
      now: () => now.t,
      proactiveSkewMs: 1_000,
      minProactiveIntervalMs: 10,
      refresh: async () => {
        refreshCalls += 1;
        return { accessToken: `p-${refreshCalls}`, expiresIn: 5 };
      },
      broadcast: new AuthBroadcast('test-proactive', () => null),
    });

    manager.setSession('initial', 5);
    expect(refreshCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(refreshCalls).toBe(1);
    expect(manager.getAccessToken()).toBe('p-1');

    manager.dispose();
  });

  it('postAuthV2Refresh sends CSRF + credentials', async () => {
    const transport = vi.fn(async ({ url, init }) => {
      expect(url).toBe('/api/v2/auth/refresh');
      expect(init.credentials).toBe('include');
      expect(new Headers(init.headers).get('X-ONIX-CSRF')).toBe('1');
      expect(init.method).toBe('POST');
      return jsonResponse({
        success: true,
        data: { accessToken: 'hdr', expiresIn: 900 },
      });
    });

    const result = await postAuthV2Refresh(transport);
    expect(result.accessToken).toBe('hdr');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('refresh queue: 8s refresh + 30 waiters → 1 HTTP refresh, all continue', async () => {
    let refreshCalls = 0;
    let release!: (value: { accessToken: string; expiresIn: number }) => void;
    const gate = new Promise<{ accessToken: string; expiresIn: number }>((resolve) => {
      release = resolve;
    });

    const manager = new AuthManager({
      refresh: async () => {
        refreshCalls += 1;
        return gate;
      },
      broadcast: new AuthBroadcast('test-queue-30', () => null),
    });

    const waiters = Promise.all(
      Array.from({ length: 30 }, () => manager.refreshAccessToken()),
    );

    expect(refreshCalls).toBe(1);
    release({ accessToken: 'shared-after-8s', expiresIn: 900 });
    const tokens = await waiters;

    expect(refreshCalls).toBe(1);
    expect(tokens).toHaveLength(30);
    expect(tokens.every((token) => token === 'shared-after-8s')).toBe(true);
    manager.dispose();
  });

  it('Refresh Cancellation: logout during refresh discards late token', async () => {
    let release!: (value: { accessToken: string; expiresIn: number }) => void;
    const gate = new Promise<{ accessToken: string; expiresIn: number }>((resolve) => {
      release = resolve;
    });

    const manager = new AuthManager({
      refresh: async () => gate,
      broadcast: new AuthBroadcast('test-cancel', () => null),
    });

    const pending = manager.refreshAccessToken();
    manager.clearSession('logout');
    expect(manager.getAccessToken()).toBeNull();

    release({ accessToken: 'should-not-stick', expiresIn: 900 });
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_SESSION_CLEARED' });
    expect(manager.getAccessToken()).toBeNull();
    manager.dispose();
  });

  it('Double Logout: Tab A then Tab B logout throws nothing', () => {
    const bus = new MemoryAuthBroadcastBus();
    const tabA = new AuthManager({
      refresh: async () => ({ accessToken: 'a', expiresIn: 900 }),
      broadcast: new AuthBroadcast('onix-double-logout', (name) => bus.create(name)),
    });
    const tabB = new AuthManager({
      refresh: async () => ({ accessToken: 'b', expiresIn: 900 }),
      broadcast: new AuthBroadcast('onix-double-logout', (name) => bus.create(name)),
    });

    tabA.setSession('tok', 900, { broadcast: false });
    tabB.setSession('tok', 900, { broadcast: false });

    expect(() => tabA.clearSession('logout')).not.toThrow();
    expect(() => tabB.clearSession('logout')).not.toThrow();
    expect(tabA.getAccessToken()).toBeNull();
    expect(tabB.getAccessToken()).toBeNull();

    tabA.dispose();
    tabB.dispose();
  });

  it('dispose cancels timer and closes broadcast (no listener leak after teardown)', () => {
    const bus = new MemoryAuthBroadcastBus();
    const channelName = 'onix-dispose';
    const manager = new AuthManager({
      refresh: async () => ({ accessToken: 'x', expiresIn: 900 }),
      broadcast: new AuthBroadcast(channelName, (name) => bus.create(name)),
      proactiveSkewMs: 60_000,
      minProactiveIntervalMs: 10,
      now: () => 0,
    });

    manager.setSession('live', 120);
    manager.dispose();

    expect(manager.getAccessToken()).toBeNull();
    expect(() => manager.setSession('nope', 900)).toThrow(/disposed/);
  });
});

describe('AuthManager singleton', () => {
  beforeEach(() => {
    resetMemoryAccessTokenStore();
  });

  it('AuthV2 providers share exactly one AuthManager', async () => {
    const { resetSharedAuthManager, peekSharedAuthManager, getSharedAuthManager } = await import('./sharedAuthManager');
    const { AuthV2WebsiteAuthProvider } = await import('./AuthV2WebsiteAuthProvider');
    resetSharedAuthManager();

    expect(peekSharedAuthManager()).toBeNull();
    const a = new AuthV2WebsiteAuthProvider();
    const b = new AuthV2WebsiteAuthProvider();
    expect(a.getAuthManager()).toBe(b.getAuthManager());
    expect(a.getAuthManager()).toBe(getSharedAuthManager());
    expect(peekSharedAuthManager()).toBe(a.getAuthManager());

    resetSharedAuthManager();
    expect(peekSharedAuthManager()).toBeNull();
  });
});
