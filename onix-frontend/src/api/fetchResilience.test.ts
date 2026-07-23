import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isRetryableHttpStatus,
  isRetryableNetworkError,
  resilientFetch,
} from './fetchResilience';

describe('fetchResilience', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('does not retry 401/403', () => {
    expect(isRetryableHttpStatus(401)).toBe(false);
    expect(isRetryableHttpStatus(403)).toBe(false);
    expect(isRetryableHttpStatus(502)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
  });

  it('treats Failed to fetch as retryable network error', () => {
    expect(isRetryableNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableNetworkError(new Error('ERR_CONNECTION_RESET'))).toBe(true);
  });

  it('retries 503 then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const pending = resilientFetch('/api/health/live', { maxRetries: 2, timeoutMs: 5_000 });
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('retries connection reset then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const pending = resilientFetch('/api/users/me', { maxRetries: 3, timeoutMs: 5_000 });
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('uses default maxRetries of 3 for RU connection resets', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const pending = resilientFetch('/api/products', { timeoutMs: 5_000 });
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('does not retry our own AbortController timeout by default', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = resilientFetch('/api/v2/auth/refresh', { maxRetries: 2, timeoutMs: 1_000 });
    const expectation = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('retries once after timeout when maxTimeoutRetries=1', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise((resolve, reject) => {
      calls += 1;
      if (calls === 1) {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
        return;
      }
      resolve({ ok: true, status: 200 });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = resilientFetch('/api/products', {
      maxRetries: 0,
      maxTimeoutRetries: 1,
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not retry 401 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    const response = await resilientFetch('/api/users/me', { maxRetries: 2 });
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
