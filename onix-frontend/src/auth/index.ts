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
