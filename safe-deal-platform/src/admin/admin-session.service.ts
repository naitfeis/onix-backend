import { Injectable } from '@nestjs/common';
import type { AdminRole, Prisma } from '@prisma/client';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import { createId } from '../economy/wallet/cuid';
import { PrismaService } from '../prisma.service';
import { hashIp } from './admin-crypto';
import { AdminTokenService } from './admin-token.service';

const ADMIN_SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS ?? 8 * 60 * 60 * 1000);

export type AdminActor = {
  id: bigint;
  email: string;
  role: AdminRole;
  sessionId: string;
};

@Injectable()
export class AdminSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AdminTokenService,
  ) {}

  async createSession(input: {
    adminUserId: bigint;
    role: AdminRole;
    email: string;
    ip?: string | null;
    userAgent?: string | null;
    db?: Prisma.TransactionClient;
  }): Promise<{ accessToken: string; refreshToken: string; actor: AdminActor; maxAgeSeconds: number }> {
    const db = input.db ?? this.prisma;
    const refresh = this.tokens.issueRefreshToken();
    const sessionId = createId();
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS);
    await db.adminSession.create({
      data: {
        id: sessionId,
        adminUserId: input.adminUserId,
        refreshTokenHash: refresh.hash,
        ipHash: hashIp(input.ip),
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        expiresAt,
      },
    });
    const accessToken = this.tokens.issueAccessToken({
      adminUserId: input.adminUserId,
      sessionId,
      role: input.role,
    });
    return {
      accessToken,
      refreshToken: refresh.token,
      maxAgeSeconds: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
      actor: {
        id: input.adminUserId,
        email: input.email,
        role: input.role,
        sessionId,
      },
    };
  }

  async validateAccess(token: string): Promise<AdminActor> {
    const claims = this.tokens.verifyAccessToken(token);
    const session = await this.prisma.adminSession.findUnique({
      where: { id: claims.sid },
      include: { adminUser: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new AuthPlatformError('AUTH_SESSION_EXPIRED', 'Admin session is expired or revoked.');
    }
    if (session.adminUserId.toString() !== claims.sub) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Admin session subject mismatch.');
    }
    return {
      id: session.adminUser.id,
      email: session.adminUser.email,
      role: session.adminUser.role,
      sessionId: session.id,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    await this.prisma.adminSession.updateMany({
      where: { refreshTokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
