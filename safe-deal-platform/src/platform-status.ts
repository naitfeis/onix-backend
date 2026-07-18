import { PlatformStatus } from '@prisma/client';

export const PLATFORM_STATUSES = [
  'USER',
  'VERIFIED_SELLER',
  'MODERATOR',
  'ADMIN',
  'SUPER_ADMIN',
  'VIP',
] as const satisfies ReadonlyArray<PlatformStatus>;

export type PlatformStatusCode = (typeof PLATFORM_STATUSES)[number];

/** Staff flags derived from public platform status. */
export function flagsFromPlatformStatus(status: PlatformStatus): {
  isAdmin: boolean;
  isSupport: boolean;
} {
  if (status === 'SUPER_ADMIN' || status === 'ADMIN') return { isAdmin: true, isSupport: true };
  if (status === 'MODERATOR') return { isAdmin: false, isSupport: true };
  return { isAdmin: false, isSupport: false };
}

export function isSuperAdminStatus(status: PlatformStatus | null | undefined): boolean {
  return status === 'SUPER_ADMIN';
}

/** ADMIN or SUPER_ADMIN (or legacy isAdmin flag). */
export function isPrivilegedAdmin(
  user: { platformStatus?: PlatformStatus | null; isAdmin?: boolean },
): boolean {
  return Boolean(
    user.isAdmin
    || user.platformStatus === 'ADMIN'
    || user.platformStatus === 'SUPER_ADMIN',
  );
}

/** Public badge — omit USER to keep UI quiet for default accounts. */
export function statusBadge(status: PlatformStatus | null | undefined): PlatformStatusCode | undefined {
  if (!status || status === 'USER') return undefined;
  return status;
}

export function isPlatformStatus(value: string): value is PlatformStatus {
  return (PLATFORM_STATUSES as readonly string[]).includes(value);
}
