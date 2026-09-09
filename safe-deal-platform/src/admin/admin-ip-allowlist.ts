/**
 * Slice 6 — optional IP allowlist for admin / support dangerous ops.
 * Empty env = not enforced (dev-friendly). When set, client IP must match exactly.
 */

import { ForbiddenException } from '@nestjs/common';
import { normalizeIp, resolveClientIp, type ClientIpRequestLike } from '../http/client-ip';

/** Parse ADMIN_IP_ALLOWLIST. Returns null when unset / empty (allow all). */
export function parseAdminIpAllowlist(
  raw: string | undefined = process.env.ADMIN_IP_ALLOWLIST,
): string[] | null {
  if (raw === undefined || raw.trim() === '') return null;
  const list = raw
    .split(/[,;\s]+/)
    .map((part) => normalizeIp(part))
    .filter((part): part is string => Boolean(part));
  return list.length > 0 ? list : null;
}

export function isAdminIpAllowed(
  clientIp: string | null | undefined,
  allowlist: string[] | null = parseAdminIpAllowlist(),
): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  const n = normalizeIp(clientIp);
  if (!n) return false;
  const lower = n.toLowerCase();
  return allowlist.some((entry) => entry.toLowerCase() === lower);
}

export function assertAdminIpAllowed(req: ClientIpRequestLike): void {
  const allowlist = parseAdminIpAllowlist();
  if (!allowlist) return;
  const ip = resolveClientIp(req);
  if (!isAdminIpAllowed(ip, allowlist)) {
    const err = new Error('ADMIN_IP_FORBIDDEN');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
}

/**
 * Money / ban / wipe mutations in production require ADMIN_IP_ALLOWLIST
 * and a matching client IP. Dev without allowlist stays open.
 */
export function assertDangerousAdminIp(req: ClientIpRequestLike): void {
  const allowlist = parseAdminIpAllowlist();
  const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
  if (!allowlist) {
    if (isProd) {
      throw new ForbiddenException(
        'В production задайте ADMIN_IP_ALLOWLIST для опасных admin-операций (ban/wipe/money).',
      );
    }
    return;
  }
  const ip = resolveClientIp(req);
  if (!isAdminIpAllowed(ip, allowlist)) {
    throw new ForbiddenException('IP не в ADMIN_IP_ALLOWLIST.');
  }
}
