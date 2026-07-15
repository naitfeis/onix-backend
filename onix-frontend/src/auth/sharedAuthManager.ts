import { AuthManager } from './AuthManager';
import { resetMemoryAccessTokenStore } from './memoryAccessToken';

let shared: AuthManager | null = null;
let pagehideInstalled = false;

/**
 * Process-wide AuthManager singleton for Auth V2.
 * Providers must call this — never `new AuthManager()` in app code.
 * Created lazily on first AuthV2 provider construction (legacy mode never creates it).
 */
export function getSharedAuthManager(): AuthManager {
  if (!shared) {
    shared = new AuthManager();
    installPagehideDispose();
  }
  return shared;
}

export function resetSharedAuthManager(): void {
  shared?.dispose();
  shared = null;
  resetMemoryAccessTokenStore();
}

/** Exactly one shared instance (or null before first use / after reset). */
export function peekSharedAuthManager(): AuthManager | null {
  return shared;
}

function installPagehideDispose(): void {
  if (pagehideInstalled) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  pagehideInstalled = true;
  window.addEventListener('pagehide', () => {
    // Tab close / navigation: destroy timer + BroadcastChannel (no listener leak).
    resetSharedAuthManager();
  });
}
