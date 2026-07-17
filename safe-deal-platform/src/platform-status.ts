import { PlatformStatus } from '@prisma/client';

export const PLATFORM_STATUSES = [
  'USER',
  'VERIFIED_SELLER',
  'MODERATOR',
  'ADMIN',
  'VIP',
] as const satisfies ReadonlyArray<PlatformStatus>;

export type PlatformStatusCode = (typeof PLATFORM_STATUSES)[number];

/** Staff flags derived from public platform status. */
export function flagsFromPlatformStatus(status: PlatformStatus): {
  isAdmin: boolean;
  isSupport: boolean;
} {
  if (status === 'ADMIN') return { isAdmin: true, isSupport: true };
  if (status === 'MODERATOR') return { isAdmin: false, isSupport: true };
  return { isAdmin: false, isSupport: false };
}

/** Public badge — omit USER to keep UI quiet for default accounts. */
export function statusBadge(status: PlatformStatus | null | undefined): PlatformStatusCode | undefined {
  if (!status || status === 'USER') return undefined;
  return status;
}

export function isPlatformStatus(value: string): value is PlatformStatus {
  return (PLATFORM_STATUSES as readonly string[]).includes(value);
}
