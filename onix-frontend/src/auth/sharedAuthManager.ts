import { AuthManager } from './AuthManager';
import { resetMemoryAccessTokenStore } from './memoryAccessToken';

let shared: AuthManager | null = null;

/** Process-wide AuthManager for Auth V2 provider (created only when V2 provider is constructed). */
export function getSharedAuthManager(): AuthManager {
  if (!shared) shared = new AuthManager();
  return shared;
}

export function resetSharedAuthManager(): void {
  shared?.dispose();
  shared = null;
  resetMemoryAccessTokenStore();
}
