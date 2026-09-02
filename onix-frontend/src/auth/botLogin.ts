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
  miniAppDeepLink?: string;
  startCommand?: string;
  provider: string;
};

export class BotLoginError extends Error {
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'BotLoginError';
    this.code = code;
    this.details = details;
  }
}

type Envelope<T> = { success: boolean; data: T; error?: { code?: string; message?: string; details?: unknown }; message?: string };

async function readData<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw.trim()) {
    throw new BotLoginError(
      `API вернул пустой ответ (${response.status}). `
      + 'www должен указывать на onix-api (SPA+API) или на прокси с /api → Nest — не на отдельный Static Site.',
      'AUTH_API_EMPTY_RESPONSE',
    );
  }
  let payload: Envelope<T>;
  try {
    payload = JSON.parse(raw) as Envelope<T>;
  } catch {
    throw new BotLoginError(
      `API вернул не JSON (${response.status}). Проверьте, что /api идёт на Nest, а не на статику.`,
      'AUTH_API_NOT_JSON',
    );
  }
  if (!response.ok || !payload.success) {
    const msg = payload.error?.message || payload.message || 'Login challenge failed.';
    throw new BotLoginError(
      Array.isArray(msg) ? msg.join(' ') : msg,
      payload.error?.code,
      payload.error?.details,
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
    // Website persistent session: rememberMe so cookie survives browser close (~30d idle).
    body: JSON.stringify({ challengeId, rememberMe: true }),
    signal,
  });
  const data = await readData<{ accessToken: string; expiresIn: number }>(response);
  getSharedAuthManager().setSession(data.accessToken, data.expiresIn);
}

export async function continueBotLogin(_exchangeCode: string, _signal?: AbortSignal): Promise<void> {
  void _exchangeCode;
  void _signal;
  throw new BotLoginError(
    'Exchange-code login is disabled. Stay on this tab; polling completes after Telegram confirm.',
    'AUTH_LOGIN_CHALLENGE_INVALID',
  );
}

/**
 * Poll until CONFIRMED (ready) then complete exactly once on the same SPA URL.
 * No /login/continue, no ?x=, no location changes.
 */
export async function waitUntilBotConfirmed(
  challengeId: string,
  options?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 12 * 60 * 1000;
  const intervalMs = options?.intervalMs ?? 1_500;
  const signal = options?.signal;
  const started = Date.now();

  while (true) {
    if (signal?.aborted) {
      throw new BotLoginError('Login cancelled.', 'ABORTED');
    }
    if (Date.now() - started >= timeoutMs) {
      throw new BotLoginError(
        'Login challenge timed out. Confirm in Telegram while keeping this tab open.',
        'AUTH_LOGIN_CHALLENGE_EXPIRED',
      );
    }

    let status: { status: string; expiresAt: string };
    try {
      status = await pollBotLoginStatus(challengeId, signal);
    } catch (error) {
      if (signal?.aborted) throw new BotLoginError('Login cancelled.', 'ABORTED');
      if (error instanceof BotLoginError && error.code === 'AUTH_LOGIN_CHALLENGE_EXPIRED') throw error;
      await delay(intervalMs, signal);
      continue;
    }

    if (status.status === 'CONFIRMED') return;
    if (status.status === 'EXPIRED') {
      throw new BotLoginError('Login challenge expired.', 'AUTH_LOGIN_CHALLENGE_EXPIRED');
    }
    if (status.status === 'CONSUMED') {
      throw new BotLoginError('Login challenge already used.', 'AUTH_LOGIN_CHALLENGE_CONSUMED');
    }

    await delay(intervalMs, signal);
  }
}

export async function waitAndCompleteBotLogin(
  challengeId: string,
  options?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal },
): Promise<void> {
  await waitUntilBotConfirmed(challengeId, options);
  await completeBotLogin(challengeId, options?.signal);
}

export async function completeBotLink(challengeId: string, signal?: AbortSignal): Promise<void> {
  const token = getSharedAuthManager().getAccessToken();
  if (!token) {
    throw new BotLoginError('Session expired. Sign in again, then link Telegram.', 'AUTH_INVALID_TOKEN');
  }
  const response = await fetch(buildApiUrl('/api/v2/auth/telegram-bot/link', resolveApiBase()), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ challengeId }),
    signal,
  });
  await readData<{ linked: true; hasTelegram: true; canSell: true }>(response);
}

export async function waitAndLinkBotTelegram(
  challengeId: string,
  options?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal },
): Promise<void> {
  await waitUntilBotConfirmed(challengeId, options);
  await completeBotLink(challengeId, options?.signal);
}

export async function confirmBotLoginFromMini(
  challengeId: string,
  initData: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(buildApiUrl('/api/v2/auth/telegram-bot/confirm-mini', resolveApiBase()), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId, initData }),
    signal,
  });
  await readData<{ challengeId: string; status: string }>(response);
}

/**
 * Mini App opened via startapp=login_<id>: confirm the website tab's challenge.
 * Retries briefly — Telegram often injects initData a tick after first paint.
 */
export async function confirmWebsiteLoginFromMiniAppIfNeeded(): Promise<boolean> {
  const { getTelegramInitData, getTelegramStartParam } = await import('./telegramEnv');
  const hash = typeof location !== 'undefined' ? location.hash : '';
  const search = typeof location !== 'undefined' ? location.search : '';
  const maybeLogin = getTelegramStartParam().startsWith('login_')
    || hash.includes('tgWebAppStartParam')
    || search.includes('tgWebAppStartParam');
  if (!maybeLogin) return false;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const startParam = getTelegramStartParam();
    if (!startParam.startsWith('login_')) {
      await delay(150);
      continue;
    }
    const challengeId = startParam.slice('login_'.length).trim();
    const initData = getTelegramInitData();
    if (!challengeId || !initData) {
      await delay(150);
      continue;
    }
    try {
      await confirmBotLoginFromMini(challengeId, initData);
      return true;
    } catch {
      await delay(150);
    }
  }
  return false;
}

/** Open Telegram without navigating away from the Website tab (keeps polling alive). */
export function openTelegramBotLogin(
  _deepLink: string,
  webDeepLink: string,
  miniAppDeepLink?: string,
): void {
  const openBlank = (href: string) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  // startapp confirms via Mini App initData even when Desktop focuses an existing chat.
  // start= is the fallback when Mini App is blocked.
  openBlank(miniAppDeepLink || webDeepLink);
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
