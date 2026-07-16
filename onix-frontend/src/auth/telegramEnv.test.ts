import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  try {
    delete (globalThis as typeof globalThis & { Telegram?: unknown }).Telegram;
  } catch {
    /* ignore */
  }
});

describe('telegramEnv website isolation', () => {
  it('is false on ordinary www (no Telegram inject, no SDK stub)', async () => {
    const { isTelegramMiniApp, getTelegramInitData } = await import('./telegramEnv');
    expect(isTelegramMiniApp()).toBe(false);
    expect(getTelegramInitData()).toBe('');
  });

  it('is true when Telegram injects non-empty initData', async () => {
    vi.stubGlobal('Telegram', {
      WebApp: { initData: 'query_id=1&user=%7B%22id%22%3A1%7D&hash=abc', platform: 'ios' },
    });
    const { isTelegramMiniApp, getTelegramInitData } = await import('./telegramEnv');
    expect(isTelegramMiniApp()).toBe(true);
    expect(getTelegramInitData().length).toBeGreaterThan(0);
  });

  it('does not treat empty initData + platform unknown as Mini App', async () => {
    const ready = vi.fn();
    const expand = vi.fn();
    vi.stubGlobal('Telegram', {
      WebApp: { initData: '', platform: 'unknown', ready, expand },
    });
    const { isTelegramMiniApp, signalTelegramReadyIfMiniApp } = await import('./telegramEnv');
    expect(isTelegramMiniApp()).toBe(false);
    signalTelegramReadyIfMiniApp();
    expect(ready).not.toHaveBeenCalled();
    expect(expand).not.toHaveBeenCalled();
  });

  it('calls ready/expand on injected WebApp only when Mini App', async () => {
    const ready = vi.fn();
    const expand = vi.fn();
    vi.stubGlobal('Telegram', {
      WebApp: {
        initData: 'query_id=1&auth_date=1&user=%7B%22id%22%3A1%7D&hash=test',
        platform: 'android',
        ready,
        expand,
      },
    });
    const { signalTelegramReadyIfMiniApp } = await import('./telegramEnv');
    signalTelegramReadyIfMiniApp();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(expand).toHaveBeenCalledTimes(1);
  });
});
