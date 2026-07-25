/**
 * Slice 3 — Telegram MFA step-up for high-risk actions (withdraw).
 */

export const MFA_PURPOSE_WITHDRAW = 'WITHDRAW';

export type MfaChallengeStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CONSUMED'
  | 'CANCELED'
  | 'EXPIRED'
  | 'FAILED';

export type IssuedMfaChallenge = {
  challengeId: string;
  expiresAt: string;
  deepLink: string;
  webDeepLink: string;
  delivery: 'telegram' | 'deeplink';
};

export function mfaChallengeTtlMs(): number {
  const n = Number(process.env.MFA_CHALLENGE_TTL_MS ?? 600_000);
  return Number.isFinite(n) && n >= 60_000 && n <= 3_600_000 ? Math.floor(n) : 600_000;
}

export function telegramBotUsername(): string {
  const raw = process.env.TELEGRAM_BOT_USERNAME || process.env.VITE_TELEGRAM_BOT_USERNAME || 'Onixshop_bot';
  return raw.replace(/^@/, '');
}

export function mfaDeepLinks(challengeId: string): { deepLink: string; webDeepLink: string } {
  const bot = telegramBotUsername();
  const payload = `mfa_${challengeId}`;
  return {
    deepLink: `tg://resolve?domain=${bot}&start=${payload}`,
    webDeepLink: `https://t.me/${bot}?start=${payload}`,
  };
}
