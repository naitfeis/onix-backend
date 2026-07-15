import { buildApiUrl, resolveApiBase } from './apiConfig';
import { getSharedAuthManager } from './sharedAuthManager';
import { getAuthV2Me } from './v2AuthApi';

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

type Envelope<T> = { success: boolean; data: T; error?: { message?: string }; message?: string };

async function readData<T>(response: Response): Promise<T> {
  const payload = await response.json() as Envelope<T>;
  if (!response.ok || !payload.success) {
    const msg = payload.error?.message || payload.message || 'Login challenge failed.';
    throw new Error(Array.isArray(msg) ? msg.join(' ') : msg);
  }
  return payload.data;
}

/**
 * Native Telegram bot login (no widget / oauth embed).
 * Uses AuthManager for access memory; refresh cookie set by complete.
 */
export async function startBotLogin(): Promise<BotLoginStartResult> {
  const response = await fetch(buildApiUrl('/api/v2/auth/telegram-bot/start', resolveApiBase()), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}',
  });
  return readData<BotLoginStartResult>(response);
}

export async function pollBotLoginStatus(challengeId: string): Promise<{ status: string; expiresAt: string }> {
  const url = buildApiUrl(`/api/v2/auth/telegram-bot/status?challengeId=${encodeURIComponent(challengeId)}`, resolveApiBase());
  const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
  return readData(response);
}

export async function completeBotLogin(challengeId: string): Promise<void> {
  const response = await fetch(buildApiUrl('/api/v2/auth/telegram-bot/complete', resolveApiBase()), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId }),
  });
  const data = await readData<{ accessToken: string; expiresIn: number }>(response);
  const manager = getSharedAuthManager();
  manager.setSession(data.accessToken, data.expiresIn);
  await getAuthV2Me(data.accessToken, fetch, resolveApiBase());
}

/** Poll until CONFIRMED then complete; throws on EXPIRED/timeout. */
export async function waitAndCompleteBotLogin(
  challengeId: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const intervalMs = options?.intervalMs ?? 1_500;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const status = await pollBotLoginStatus(challengeId);
    if (status.status === 'CONFIRMED') {
      await completeBotLogin(challengeId);
      return;
    }
    if (status.status === 'EXPIRED' || status.status === 'CONSUMED') {
      throw new Error('Login challenge expired or already used.');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Login challenge timed out. Confirm in Telegram or tap «Вернуться в ONIX».');
}

export function openTelegramBotLogin(deepLink: string, webDeepLink: string): void {
  // Prefer app deep link; fallback to t.me (Telegram Web / install prompt).
  const opened = window.open(deepLink, '_blank');
  if (!opened) {
    window.location.href = webDeepLink;
  } else {
    // Also navigate same tab fallback for mobile browsers that block tg://
    setTimeout(() => {
      try {
        if (document.visibilityState === 'visible') {
          window.location.href = webDeepLink;
        }
      } catch {
        /* ignore */
      }
    }, 800);
  }
}
