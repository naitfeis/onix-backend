/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  readonly VITE_DEV_PORT?: string;
  readonly VITE_TELEGRAM_BOT_USERNAME?: string;
  readonly VITE_WEBSITE_AUTH_MODE?: string;
  readonly VITE_WEBSITE_LOGIN_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
