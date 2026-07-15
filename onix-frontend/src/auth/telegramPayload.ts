import type { AuthV2LoginRequest } from './v2AuthApi';

/**
 * Coerce Telegram Login Widget payload → backend TelegramLoginBodyDto.
 * Widget often sends `id` as number; DTO requires string matching /^\d+$/.
 */
export function normalizeTelegramLoginPayload(
  payload: Record<string, string | number>,
): AuthV2LoginRequest['telegram'] {
  const id = String(payload.id ?? '').trim();
  if (!/^\d+$/.test(id)) {
    throw new Error('Telegram login payload id must be a numeric string.');
  }

  const firstName = String(payload.first_name ?? '').trim();
  if (!firstName) {
    throw new Error('Telegram login payload first_name is required.');
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate) || authDate < 1) {
    throw new Error('Telegram login payload auth_date is invalid.');
  }

  const hash = String(payload.hash ?? '').trim();
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error('Telegram login payload hash is invalid.');
  }

  const telegram: AuthV2LoginRequest['telegram'] = {
    id,
    first_name: firstName,
    auth_date: Math.floor(authDate),
    hash,
  };

  if (payload.last_name !== undefined && String(payload.last_name).length > 0) {
    telegram.last_name = String(payload.last_name);
  }
  if (payload.username !== undefined && String(payload.username).length > 0) {
    telegram.username = String(payload.username);
  }
  if (payload.photo_url !== undefined && String(payload.photo_url).length > 0) {
    telegram.photo_url = String(payload.photo_url);
  }

  return telegram;
}
