export type {
  WebsiteAuthMode,
  WebsiteAuthProvider,
  WebsiteAuthSessionSummary,
  WebsiteAuthUser,
} from './types';

export {
  buildApiUrl,
  isSameOriginApi,
  resolveApiBase,
  shouldIncludeCredentials,
} from './apiConfig';

export { isWebsiteAuthV2, resolveWebsiteAuthMode } from './mode';

export {
  createWebsiteAuthProvider,
  getWebsiteAuthProvider,
  resetWebsiteAuthProvider,
} from './createWebsiteAuthProvider';

export { LegacyWebsiteAuthProvider } from './LegacyWebsiteAuthProvider';
export { AuthV2WebsiteAuthProvider } from './AuthV2WebsiteAuthProvider';

export { AuthManager } from './AuthManager';
export type { AuthManagerOptions } from './AuthManager';

export { AuthBroadcast, MemoryAuthBroadcastBus } from './authBroadcast';
export type { AuthBroadcastEvent } from './authBroadcast';

export { postAuthV2Refresh, RefreshError } from './refreshClient';
export type { RefreshSuccess, RefreshTransport } from './refreshClient';

export {
  clearMemoryAccessToken,
  readMemoryAccessToken,
  resetMemoryAccessTokenStore,
  writeMemoryAccessToken,
} from './memoryAccessToken';

export { getSharedAuthManager, resetSharedAuthManager } from './sharedAuthManager';
