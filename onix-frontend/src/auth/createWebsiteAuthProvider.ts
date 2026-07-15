import { AuthV2WebsiteAuthProvider } from './AuthV2WebsiteAuthProvider';
import { LegacyWebsiteAuthProvider } from './LegacyWebsiteAuthProvider';
import { resolveWebsiteAuthMode } from './mode';
import type { WebsiteAuthMode, WebsiteAuthProvider } from './types';

let cached: WebsiteAuthProvider | null = null;
let cachedMode: WebsiteAuthMode | null = null;

/**
 * Factory for the active Website auth provider.
 * Temporary dual support during cutover — not a permanent second auth system.
 */
export function createWebsiteAuthProvider(mode: WebsiteAuthMode = resolveWebsiteAuthMode()): WebsiteAuthProvider {
  if (mode === 'auth_v2') return new AuthV2WebsiteAuthProvider();
  return new LegacyWebsiteAuthProvider();
}

/** Process-wide provider (mode changes require resetWebsiteAuthProvider in tests). */
export function getWebsiteAuthProvider(): WebsiteAuthProvider {
  const mode = resolveWebsiteAuthMode();
  if (!cached || cachedMode !== mode) {
    cached = createWebsiteAuthProvider(mode);
    cachedMode = mode;
  }
  return cached;
}

export function resetWebsiteAuthProvider(): void {
  cached = null;
  cachedMode = null;
}
