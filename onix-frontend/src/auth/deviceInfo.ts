import type { AuthV2LoginRequest } from './v2AuthApi';

const BROWSER_ID_KEY = 'onix_browser_id';

/** Stable browser id (localStorage). Not a Mini App-restricted API. */
function getOrCreateBrowserId(): string | undefined {
  if (typeof localStorage === 'undefined' || typeof crypto === 'undefined') return undefined;
  try {
    let id = localStorage.getItem(BROWSER_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(BROWSER_ID_KEY, id);
    }
    return id.slice(0, 64);
  } catch {
    return undefined;
  }
}

/** Soft fingerprint from safe signals only (no canvas/WebGL). */
async function softFingerprintHash(parts: string[]): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  try {
    const raw = parts.filter(Boolean).join('|');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 64);
  } catch {
    return undefined;
  }
}

/** Safe device metadata for login/refresh (no canvas/WebGL / Mini App-only APIs). */
export function collectDeviceInfo(): AuthV2LoginRequest['device'] {
  if (typeof navigator === 'undefined') return undefined;

  const language = navigator.language?.slice(0, 32);
  const userAgent = navigator.userAgent?.slice(0, 512);
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 64);
  } catch {
    timezone = undefined;
  }

  const platform = navigator.platform?.slice(0, 64) || undefined;
  const browserId = getOrCreateBrowserId();
  const screenResolution = typeof screen !== 'undefined'
    ? `${screen.width}x${screen.height}`.slice(0, 32)
    : undefined;

  return {
    ...(platform ? { platform } : {}),
    ...(timezone ? { timezone } : {}),
    ...(language ? { language } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(browserId ? { browserId } : {}),
    ...(screenResolution ? { screenResolution } : {}),
  };
}

/** Async enrich with soft fingerprintHash (Website login path). */
export async function collectDeviceInfoAsync(): Promise<AuthV2LoginRequest['device']> {
  const base = collectDeviceInfo();
  if (!base) return undefined;
  const fingerprintHash = await softFingerprintHash([
    base.browserId ?? '',
    base.userAgent ?? '',
    base.language ?? '',
    base.timezone ?? '',
    base.platform ?? '',
    base.screenResolution ?? '',
  ]);
  return {
    ...base,
    ...(fingerprintHash ? { fingerprintHash } : {}),
  };
}
