import { formatClientIpForPrompt } from '../http/client-ip';

/**
 * Formats LoginChallenge metadata for the Telegram confirm prompt.
 * Does not change LoginChallenge storage — read-only presentation.
 */

export type LoginChallengePromptSource = {
  createdAt: Date;
  createdIp?: string | null;
  createdUserAgent?: string | null;
};

export type ParsedClientHints = {
  browser: string;
  os: string;
};

export function parseUserAgentHints(ua?: string | null): ParsedClientHints {
  if (!ua?.trim()) {
    return { browser: 'Неизвестно', os: 'Неизвестно' };
  }
  const value = ua.trim();

  let os = 'Неизвестно';
  if (/Windows NT 10/i.test(value)) os = 'Windows 10/11';
  else if (/Windows NT 6\.3/i.test(value)) os = 'Windows 8.1';
  else if (/Windows/i.test(value)) os = 'Windows';
  else if (/Android/i.test(value)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(value)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(value)) os = 'macOS';
  else if (/Linux/i.test(value)) os = 'Linux';
  else if (/CrOS/i.test(value)) os = 'Chrome OS';

  let browser = 'Неизвестно';
  if (/Edg\//i.test(value)) browser = 'Microsoft Edge';
  else if (/OPR\/|Opera/i.test(value)) browser = 'Opera';
  else if (/Firefox\//i.test(value)) browser = 'Firefox';
  else if (/Chrome\//i.test(value) && !/Edg\//i.test(value)) browser = 'Chrome';
  else if (/Safari\//i.test(value) && !/Chrome\//i.test(value)) browser = 'Safari';

  return { browser, os };
}

export function formatLoginAttemptTime(at: Date, now = new Date()): string {
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Europe/Moscow',
  }).format(at);
  const ageSec = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
  if (ageSec < 60) return `${formatted} (только что)`;
  if (ageSec < 3600) return `${formatted} (${Math.floor(ageSec / 60)} мин назад)`;
  return formatted;
}

/** Human-readable prompt body for Telegram (HTML parse_mode). */
export function formatLoginConfirmPrompt(
  source: LoginChallengePromptSource,
  firstName?: string,
  now = new Date(),
): string {
  const { browser, os } = parseUserAgentHints(source.createdUserAgent);
  const ip = formatClientIpForPrompt(source.createdIp);
  const when = formatLoginAttemptTime(source.createdAt, now);
  const greeting = firstName?.trim() ? `${escapeHtml(firstName.trim())}, ` : '';

  return [
    `${greeting}попытка входа в <b>ONIX</b>.`,
    '',
    `<b>Источник:</b> Website (Telegram Bot Login)`,
    `<b>Браузер:</b> ${escapeHtml(browser)}`,
    `<b>ОС:</b> ${escapeHtml(os)}`,
    `<b>IP:</b> <code>${escapeHtml(ip)}</code>`,
    `<b>Время:</b> ${escapeHtml(when)}`,
    '',
    'Это вы? Подтвердите или отмените вход.',
  ].join('\n');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
