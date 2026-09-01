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
export type { AuthV2WebsiteAuthProviderOptions } from './AuthV2WebsiteAuthProvider';

export { AuthManager } from './AuthManager';
export type { AuthManagerOptions } from './AuthManager';

export { AuthBroadcast, MemoryAuthBroadcastBus } from './authBroadcast';
export type { AuthBroadcastEvent } from './authBroadcast';

export { postAuthV2Refresh, RefreshError, isDefinitiveAuthRefreshFailure, isTransientRefreshFailure } from './refreshClient';
export type { RefreshSuccess, RefreshTransport } from './refreshClient';

export {
  clearMemoryAccessToken,
  readMemoryAccessToken,
  resetMemoryAccessTokenStore,
  writeMemoryAccessToken,
} from './memoryAccessToken';

export { getSharedAuthManager, peekSharedAuthManager, resetSharedAuthManager } from './sharedAuthManager';

export { startGoogleOAuth, consumeGoogleOAuthRedirect } from './googleOAuth';

export {
  AuthV2ApiError,
  getAuthV2Me,
  getAuthV2Session,
  probeRefreshCookiePresence,
  probeAuthV2Session,
  postAuthV2Login,
  postAuthV2Google,
  getAuthV2PublicConfig,
  postAuthV2Logout,
} from './v2AuthApi';
export type {
  AuthV2LoginData,
  AuthV2LoginRequest,
  AuthV2MeData,
  AuthV2SessionData,
  AuthV2SessionProbe,
} from './v2AuthApi';

export { normalizeTelegramLoginPayload } from './telegramPayload';
export { collectDeviceInfo, collectDeviceInfoAsync } from './deviceInfo';
export {
  ensureTelegramMiniAppReady,
  getTelegramInitData,
  isTelegramMiniApp,
  signalTelegramReadyIfMiniApp,
  telegramHaptic,
  telegramImpact,
} from './telegramEnv';
export {
  getWebsiteLoginProvider,
  openTelegramBotLogin,
  startBotLogin,
  waitAndCompleteBotLogin,
  completeBotLogin,
  continueBotLogin,
  pollBotLoginStatus,
  BotLoginError,
} from './botLogin';
export type { BotLoginStartResult, WebsiteLoginProvider } from './botLogin';
