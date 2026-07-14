import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

interface CacheEntry {
  permissionVersion: number;
  permissions: string[];
  roles: string[];
  expiresAt: number;
}

/**
 * RBAC resolver with in-process cache keyed by userId+permissionVersion (ADR-024).
 */
@Injectable()
export class RbacService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = Number(process.env.AUTH_RBAC_CACHE_MS ?? 60_000);

  constructor(private readonly prisma: PrismaService) {}

  async resolveForUser(
    userId: bigint,
    permissionVersion: number,
  ): Promise<{ permissions: string[]; roles: string[] }> {
    const key = `${userId}:${permissionVersion}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now() && hit.permissionVersion === permissionVersion) {
      return { permissions: hit.permissions, roles: hit.roles };
    }

    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
      },
    });

    const roles = userRoles.map((row) => row.role.code);
    const permissions = [...new Set(
      userRoles.flatMap((row) => row.role.permissions.map((rp) => rp.permission.code)),
    )];

    this.cache.set(key, {
      permissionVersion,
      permissions,
      roles,
      expiresAt: Date.now() + this.ttlMs,
    });

    return { permissions, roles };
  }

  clearCache(): void {
    this.cache.clear();
  }
}
