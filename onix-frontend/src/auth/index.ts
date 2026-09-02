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
export type { AuthBroadcastEvent, AuthBroadcastHandler } from './authBroadcast';

export { postAuthV2Refresh, RefreshError, isDefinitiveAuthRefreshFailure, isTransientRefreshFailure } from './refreshClient';
export type { RefreshSuccess, RefreshTransport } from './refreshClient';

export {
  clearMemoryAccessToken,
  readMemoryAccessToken,
  resetMemoryAccessTokenStore,
  writeMemoryAccessToken,
} from './memoryAccessToken';

export { readJwtSub } from './jwtSub';
export { getSharedAuthManager, peekSharedAuthManager, resetSharedAuthManager } from './sharedAuthManager';

export { startGoogleOAuth, consumeGoogleOAuthRedirect, consumeGoogleOAuthIntent, GOOGLE_OAUTH_CALLBACK_PATH, PRODUCTION_GOOGLE_REDIRECT_URI } from './googleOAuth';

export {
  AuthV2ApiError,
  getAuthV2Me,
  getAuthV2Session,
  probeRefreshCookiePresence,
  probeAuthV2Session,
  postAuthV2Login,
  postAuthV2Google,
  postAuthV2LinkGoogle,
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
  getTelegramStartParam,
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
  waitAndLinkBotTelegram,
  completeBotLogin,
  continueBotLogin,
  pollBotLoginStatus,
  confirmBotLoginFromMini,
  confirmWebsiteLoginFromMiniAppIfNeeded,
  BotLoginError,
} from './botLogin';
export type { BotLoginStartResult, WebsiteLoginProvider } from './botLogin';
