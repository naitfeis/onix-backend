import { buildApiUrl, resolveApiBase } from './apiConfig';
import { getSharedAuthManager } from './sharedAuthManager';

export type WebsiteLoginProvider = 'bot' | 'widget';

/** Default bot — Widget only for rollback (VITE_WEBSITE_LOGIN_PROVIDER=widget). */
export function getWebsiteLoginProvider(): WebsiteLoginProvider {
  const raw = (import.meta.env.VITE_WEBSITE_LOGIN_PROVIDER as string | undefined)?.trim().toLowerCase();
  if (raw === 'widget') return 'widget';
  return 'bot';
}

export type BotLoginStartResult = {
  challengeId: string;
  expiresAt: string;
  status: string;
  deepLink: string;
  webDeepLink: string;
  provider: string;
};

export class BotLoginError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'BotLoginError';
    this.code = code;
  }
}

type Envelope<T> = { success: boolean; data: T; error?: { code?: string; message?: string }; message?: string };

async function readData<T>(response: Response): Promise<T> {
  const payload = await response.json() as Envelope<T>;
  if (!response.ok || !payload.success) {
    const msg = payload.error?.message || payload.message || 'Login challenge failed.';
    throw new BotLoginError(
      Array.isArray(msg) ? msg.join(' ') : msg,
      payload.error?.code,
    );
  }
  return payload.data;
}

/**
 * Native Telegram bot login (no widget / oauth embed).
 * Access stays in AuthManager memory; refresh cookie set by complete.
 */
export async function startBotLogin(signal?: AbortSignal): Promise<BotLoginStartResult> {
  const response = await fetch(buildApiUrl('/api/v2/auth/telegram-bot/start', resolveApiBase()), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}',
    signal,
  });
  return readData<BotLoginStartResult>(response);
}

export async function pollBotLoginStatus(
  challengeId: string,
  signal?: AbortSignal,
): Promise<{ status: string; expiresAt: string }> {
  const url = buildApiUrl(
    `/api/v2/auth/telegram-bot/status?challengeId=${encodeURIComponent(challengeId)}`,
    resolveApiBase(),
  );
  const response = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  return readData(response);
}

export async function completeBotLogin(challengeId: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(buildApiUrl('/api/v2/auth/telegram-bot/complete', resolveApiBase()), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId }),
    signal,
  });
  const data = await readData<{ accessToken: string; expiresIn: number }>(response);
  getSharedAuthManager().setSession(data.accessToken, data.expiresIn);
}

export async function continueBotLogin(exchangeCode: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(buildApiUrl('/api/v2/auth/telegram-bot/continue', resolveApiBase()), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ exchangeCode }),
    signal,
  });
  const data = await readData<{ accessToken: string; expiresIn: number }>(response);
  getSharedAuthManager().setSession(data.accessToken, data.expiresIn);
}

/**
 * Poll until CONFIRMED then complete exactly once.
 * Stops on EXPIRED/CONSUMED/timeout/abort — no infinite loop.
 */
export async function waitAndCompleteBotLogin(
  challengeId: string,
  options?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const intervalMs = options?.intervalMs ?? 1_500;
  const signal = options?.signal;
  const started = Date.now();
  let completed = false;

  while (!completed) {
    if (signal?.aborted) {
      throw new BotLoginError('Login cancelled.', 'ABORTED');
    }
    if (Date.now() - started >= timeoutMs) {
      throw new BotLoginError(
        'Login challenge timed out. Confirm in Telegram or tap «Вернуться в ONIX».',
        'AUTH_LOGIN_CHALLENGE_EXPIRED',
      );
    }

    let status: { status: string; expiresAt: string };
    try {
      status = await pollBotLoginStatus(challengeId, signal);
    } catch (error) {
      if (signal?.aborted) throw new BotLoginError('Login cancelled.', 'ABORTED');
      if (error instanceof BotLoginError && error.code === 'AUTH_LOGIN_CHALLENGE_EXPIRED') throw error;
      // Network blip: retry until timeout
      await delay(intervalMs, signal);
      continue;
    }

    if (status.status === 'CONFIRMED') {
      await completeBotLogin(challengeId, signal);
      completed = true;
      return;
    }
    if (status.status === 'EXPIRED') {
      throw new BotLoginError('Login challenge expired.', 'AUTH_LOGIN_CHALLENGE_EXPIRED');
    }
    if (status.status === 'CONSUMED') {
      throw new BotLoginError('Login challenge already used.', 'AUTH_LOGIN_CHALLENGE_CONSUMED');
    }

    await delay(intervalMs, signal);
  }
}

/** Open Telegram without navigating away from the Website tab (keeps polling alive). */
export function openTelegramBotLogin(deepLink: string, webDeepLink: string): void {
  const openBlank = (href: string) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  // Prefer https://t.me (works on Desktop/Web/Mobile). tg:// as secondary attempt in a blank tab.
  openBlank(webDeepLink);
  try {
    openBlank(deepLink);
  } catch {
    /* ignore */
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BotLoginError('Login cancelled.', 'ABORTED'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new BotLoginError('Login cancelled.', 'ABORTED'));
    }, { once: true });
  });
}
