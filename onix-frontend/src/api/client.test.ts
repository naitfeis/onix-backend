import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
const MINI_INIT = 'query_id=1&auth_date=1&user=%7B%22id%22%3A1%7D&hash=test';

beforeEach(() => {
  storage.clear();
  vi.resetModules();
  // Single-origin: even if misconfigured absolute URL is present, resolveApiBase strips it.
  vi.stubEnv('VITE_API_URL', '');
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => { storage.delete(key); },
  });
  vi.stubGlobal('Telegram', { WebApp: { initData: MINI_INIT } });
});

vi.mock('@twa-dev/sdk', () => ({
  default: {
    initData: 'query_id=1&auth_date=1&user=%7B%22id%22%3A1%7D&hash=test',
    ready: () => {},
    expand: () => {},
    HapticFeedback: { notificationOccurred: () => {}, impactOccurred: () => {} },
  },
}));

describe('Bearer auth bootstrap', () => {
  it('exchanges Mini App initData once and keeps JWT in session storage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { accessToken: 'jwt-token', tokenType: 'Bearer' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { bootstrapAuth } = await import('./client');

    await expect(bootstrapAuth()).resolves.toBe(true);
    expect(storage.get('onix.accessToken')).toBe('jwt-token');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/telegram-mini', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"initData"'),
      credentials: 'include',
    }));
  });

  it('refreshes an existing JWT from current Mini App initData', async () => {
    storage.set('onix.accessToken', 'stale-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { accessToken: 'fresh-token', tokenType: 'Bearer' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { bootstrapAuth } = await import('./client');

    await expect(bootstrapAuth()).resolves.toBe(true);
    expect(storage.get('onix.accessToken')).toBe('fresh-token');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/telegram-mini', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('sends Telegram Login Widget payload and stores its JWT', async () => {
    const payload = { id: 1, first_name: 'ONIX', auth_date: 1, hash: 'a'.repeat(64) };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { accessToken: 'widget-token', tokenType: 'Bearer' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loginWithTelegram } = await import('./client');

    await loginWithTelegram(payload);
    expect(storage.get('onix.accessToken')).toBe('widget-token');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/telegram-login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(payload),
    }));
  });

  it('adds Authorization and reads nested API error messages', async () => {
    storage.set('onix.accessToken', 'jwt-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200, json: async () => ({ success: true, data: { id: '1' } }),
      })
      .mockResolvedValueOnce({
        ok: false, status: 400, json: async () => ({ success: false, error: { message: 'Контракт нарушен' } }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./client');

    await api.get('/api/users/me');
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get('Authorization')).toBe('Bearer jwt-token');
    expect(request.credentials).toBe('include');
    await expect(api.get('/api/failure')).rejects.toEqual(expect.objectContaining({
      message: 'Контракт нарушен',
      status: 400,
    }));
  });

  it('ignores absolute Render VITE_API_URL and still uses relative /api', async () => {
    vi.stubEnv('VITE_API_URL', 'https://onix-api-47tj.onrender.com');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { id: '1' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./client');

    await api.get('/api/users/me');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/me', expect.objectContaining({
      credentials: 'include',
    }));
  });
});
