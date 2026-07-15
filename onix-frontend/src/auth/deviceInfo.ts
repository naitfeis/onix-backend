import type { AuthV2LoginRequest } from './v2AuthApi';

/** Safe device metadata for login/refresh (no canvas/WebGL in Phase C). */
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

  return {
    ...(platform ? { platform } : {}),
    ...(timezone ? { timezone } : {}),
    ...(language ? { language } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
