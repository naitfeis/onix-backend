/** Feature flags for Website login provider (ONIX Identity Platform Phase D). */

export type WebsiteLoginProvider = 'bot' | 'widget';

/**
 * Default: bot (native Telegram deep-link LoginChallenge).
 * Set WEBSITE_LOGIN_PROVIDER=widget only for emergency rollback to Login Widget.
 */
export function getWebsiteLoginProvider(): WebsiteLoginProvider {
  const raw = process.env.WEBSITE_LOGIN_PROVIDER?.trim().toLowerCase();
  if (raw === 'widget') return 'widget';
  return 'bot';
}

export function isWebsiteBotLoginEnabled(): boolean {
  return getWebsiteLoginProvider() === 'bot';
}

/** Telegram Desktop often delivers /start login_… minutes after the click. Keep the challenge alive. */
export const LOGIN_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const LOGIN_EXCHANGE_TTL_MS = 5 * 60 * 1000;
