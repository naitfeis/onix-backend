import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BotLoginError,
  completeBotLogin,
  waitAndCompleteBotLogin,
} from './botLogin';
import { getSharedAuthManager, resetSharedAuthManager } from './sharedAuthManager';

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify({ success: ok, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('waitAndCompleteBotLogin', () => {
  beforeEach(() => {
    resetSharedAuthManager();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    resetSharedAuthManager();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('completes once on CONFIRMED and stops polling', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: 'PENDING', expiresAt: new Date().toISOString() }))
      .mockResolvedValueOnce(jsonResponse({ status: 'CONFIRMED', expiresAt: new Date().toISOString() }))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'access-1', expiresIn: 900 }));

    await waitAndCompleteBotLogin('ch-1', { intervalMs: 1, timeoutMs: 5_000 });

    expect(getSharedAuthManager().getAccessToken()).toBe('access-1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const completeCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/telegram-bot/complete'),
    );
    expect(completeCalls).toHaveLength(1);
  });

  it('throws on EXPIRED and does not call complete', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'EXPIRED', expiresAt: new Date().toISOString() }));

    await expect(waitAndCompleteBotLogin('ch-2', { intervalMs: 1, timeoutMs: 5_000 }))
      .rejects.toMatchObject({ code: 'AUTH_LOGIN_CHALLENGE_EXPIRED' });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/complete'))).toBe(false);
  });

  it('throws on CONSUMED (double complete / already used)', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'CONSUMED', expiresAt: new Date().toISOString() }));

    await expect(waitAndCompleteBotLogin('ch-3', { intervalMs: 1, timeoutMs: 5_000 }))
      .rejects.toMatchObject({ code: 'AUTH_LOGIN_CHALLENGE_CONSUMED' });
  });

  it('aborts cleanly without infinite polling', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ status: 'PENDING', expiresAt: new Date().toISOString() }));
    const controller = new AbortController();
    const pending = waitAndCompleteBotLogin('ch-4', {
      intervalMs: 50,
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(BotLoginError);
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('completeBotLogin stores access in AuthManager memory only', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ accessToken: 'mem-token', expiresIn: 600 }),
    );
    await completeBotLogin('ch-5');
    expect(getSharedAuthManager().getAccessToken()).toBe('mem-token');
    if (typeof sessionStorage !== 'undefined') {
      expect(sessionStorage.getItem('onix.accessToken')).toBeNull();
    }
  });
});
