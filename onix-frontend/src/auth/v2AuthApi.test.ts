import { describe, expect, it, vi } from 'vitest';
import { probeRefreshCookiePresence } from './v2AuthApi';

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fast refresh cookie probe', () => {
  it('uses the DB-free session-probe endpoint', async () => {
    const fetchImpl = vi.fn(async () => envelope({ cookiePresent: true }));

    await expect(probeRefreshCookiePresence(fetchImpl, '')).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith('/api/session-probe', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }));
  });

  it('returns guest without attempting refresh when cookie is absent', async () => {
    const fetchImpl = vi.fn(async () => envelope({ cookiePresent: false }));

    await expect(probeRefreshCookiePresence(fetchImpl, '')).resolves.toEqual({
      ok: false,
      reason: 'guest',
      status: 401,
      code: 'AUTH_REFRESH_MISSING',
    });
  });

  it('classifies transport failures as network errors', async () => {
    const error = new TypeError('Failed to fetch');
    const fetchImpl = vi.fn(async () => { throw error; });

    await expect(probeRefreshCookiePresence(fetchImpl, '')).resolves.toEqual({
      ok: false,
      reason: 'network',
      error,
    });
  });
});
