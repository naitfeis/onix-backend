import type { AuthV2LoginRequest } from './v2AuthApi';

const BROWSER_ID_KEY = 'onix_browser_id';
const PWA_INSTALL_ID_KEY = 'onix_pwa_install_id';

/**
 * browserId — identifier of browser storage (localStorage), not a user id.
 * Input signal for server HMAC deviceId only.
 */
function getOrCreateBrowserId(): string | undefined {
  return getOrCreateLocalId(BROWSER_ID_KEY);
}

/**
 * pwaInstallId — identifier of this PWA installation, not a user id.
 * Distinct from browserId; input signal for server HMAC deviceId only.
 */
function getOrCreatePwaInstallId(): string | undefined {
  return getOrCreateLocalId(PWA_INSTALL_ID_KEY);
}

function getOrCreateLocalId(key: string): string | undefined {
  if (typeof localStorage === 'undefined' || typeof crypto === 'undefined') return undefined;
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id.slice(0, 64);
  } catch {
    return undefined;
  }
}

function detectBrowserFamily(ua: string): string | undefined {
  const s = ua.toLowerCase();
  if (s.includes('edg/')) return 'edge';
  if (s.includes('firefox/')) return 'firefox';
  if (s.includes('chrome/') || s.includes('crios/')) return 'chrome';
  if (s.includes('safari/') && !s.includes('chrome/')) return 'safari';
  return undefined;
}

function detectOsFamily(ua: string, platform?: string): string | undefined {
  const s = `${ua} ${platform ?? ''}`.toLowerCase();
  if (s.includes('windows')) return 'windows';
  if (s.includes('android')) return 'android';
  if (s.includes('iphone') || s.includes('ipad') || s.includes('ios')) return 'ios';
  if (s.includes('mac')) return 'macos';
  if (s.includes('linux')) return 'linux';
  return undefined;
}

/**
 * Safe device metadata for login/refresh (no canvas/WebGL).
 * Server HMAC deviceId uses only: browserFamily, osFamily, browserId, pwaInstallId.
 * timezone / language are context for Risk — not part of deviceId.
 */
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
  const pwaInstallId = getOrCreatePwaInstallId();
  const screenResolution = typeof screen !== 'undefined'
    ? `${screen.width}x${screen.height}`.slice(0, 32)
    : undefined;
  const browser = userAgent ? detectBrowserFamily(userAgent) : undefined;
  const os = userAgent ? detectOsFamily(userAgent, platform) : undefined;

  return {
    ...(browser ? { browser } : {}),
    ...(os ? { os } : {}),
    ...(platform ? { platform } : {}),
    ...(timezone ? { timezone } : {}),
    ...(language ? { language } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(browserId ? { browserId } : {}),
    ...(pwaInstallId ? { pwaInstallId } : {}),
    ...(screenResolution ? { screenResolution } : {}),
  };
}

/**
 * Device signals accepted by POST /api/auth/telegram-mini for registration risk.
 *
 * Deliberately narrow: the API runs with `forbidNonWhitelisted: true`, so sending
 * anything outside the server's DeviceDto would fail the login itself. userAgent and
 * screenResolution are intentionally omitted — the server takes the user agent from
 * the request and never trusts a client-supplied one.
 */
export type RegistrationDevicePayload = {
  browser?: string;
  os?: string;
  platform?: string;
  browserId?: string;
  pwaInstallId?: string;
  timezone?: string;
  language?: string;
};

export function collectRegistrationDevice(): RegistrationDevicePayload | undefined {
  const device = collectDeviceInfo();
  if (!device) return undefined;
  const { browser, os, platform, browserId, pwaInstallId, timezone, language } = device;
  return {
    ...(browser ? { browser } : {}),
    ...(os ? { os } : {}),
    ...(platform ? { platform } : {}),
    ...(browserId ? { browserId } : {}),
    ...(pwaInstallId ? { pwaInstallId } : {}),
    ...(timezone ? { timezone } : {}),
    ...(language ? { language } : {}),
  };
}

/** Async path kept for API compatibility — server computes trust deviceId. */
export async function collectDeviceInfoAsync(): Promise<AuthV2LoginRequest['device']> {
  return collectDeviceInfo();
}
