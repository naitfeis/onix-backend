import type { BanReason } from '@prisma/client';

/** Soft-ban is active when deletedAt is set and temporary window has not expired. */
export function isBanActive(user: {
  deletedAt: Date | null;
  bannedUntil: Date | null;
}): boolean {
  if (!user.deletedAt) return false;
  if (user.bannedUntil && user.bannedUntil.getTime() <= Date.now()) return false;
  return true;
}

export const BAN_CLEAR_DATA = {
  deletedAt: null,
  banReason: null,
  banComment: null,
  bannedAt: null,
  bannedUntil: null,
} as const;

/** Server-side ban duration policy (days). null = permanent. */
export function banDurationDays(reason: BanReason, otherDays?: number): number | null {
  switch (reason) {
    case 'MISCONDUCT':
      return 7;
    case 'THIRD_PARTY_ADS':
      return 30;
    case 'OFF_PLATFORM_DEAL':
    case 'FRAUD':
      return null;
    case 'SELLER_NO_RESPONSE':
      return 7;
    case 'OTHER':
      if (otherDays === undefined || !Number.isFinite(otherDays) || otherDays < 1 || otherDays > 3650) {
        throw new Error('Для причины OTHER укажите срок от 1 до 3650 дней.');
      }
      return otherDays;
    default:
      throw new Error('Неизвестная причина блокировки.');
  }
}

export const BAN_REASON_LABELS: Record<BanReason, string> = {
  MISCONDUCT: 'Неадекватное поведение',
  THIRD_PARTY_ADS: 'Реклама сторонней площадки',
  OFF_PLATFORM_DEAL: 'Попытка сделки вне ONIX',
  FRAUD: 'Мошенничество',
  SELLER_NO_RESPONSE: 'Продавец не отвечает',
  OTHER: 'Другое',
};

export function banPublicInfo(user: {
  banReason: BanReason | null;
  banComment: string | null;
  bannedAt: Date | null;
  bannedUntil: Date | null;
  deletedAt: Date | null;
}) {
  if (!user.deletedAt) return null;
  const permanent = !user.bannedUntil;
  const remainingMs = user.bannedUntil ? user.bannedUntil.getTime() - Date.now() : null;
  return {
    reason: user.banReason ? BAN_REASON_LABELS[user.banReason] : 'Блокировка',
    reasonCode: user.banReason,
    comment: user.banComment ?? '',
    bannedAt: user.bannedAt?.toISOString() ?? user.deletedAt.toISOString(),
    bannedUntil: user.bannedUntil?.toISOString() ?? null,
    permanent,
    remainingMs: permanent ? null : Math.max(0, remainingMs ?? 0),
    label: permanent
      ? 'Постоянная блокировка.'
      : `До ${user.bannedUntil!.toLocaleString('ru-RU')}`,
  };
}
