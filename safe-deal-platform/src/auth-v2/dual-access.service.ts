import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../common';
import { isAcceptV2AccessEnabled } from './auth-v2.flags';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/**
 * Phase 3.1 — Dual Authentication Layer (Ed25519 half).
 * Controllers never call this; AuthGuard maps both HS256 and EdDSA onto AuthUser.
 */
@Injectable()
export class DualAccessService {
  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * True when the Bearer token JWT header declares alg=EdDSA.
   * Malformed tokens return false so the legacy HS256 verifier can reject them.
   */
  isEdDsaAccessToken(token: string): boolean {
    return peekJwtAlg(token) === 'EdDSA';
  }

  isAcceptEnabled(): boolean {
    return isAcceptV2AccessEnabled();
  }

  /**
   * Verify Ed25519 access JWT + live Session/User constraints.
   * Returns the same AuthUser shape as AuthService.verifyToken.
   * Throws AuthPlatformError on failure (AuthGuard maps to UnauthorizedException).
   */
  async verifyEd25519AccessToken(token: string): Promise<AuthUser> {
    const claims = this.tokens.verifyAccessToken(token);
    const { user } = await this.sessions.validateAccessClaims(claims);
    return {
      id: user.id,
      telegramId: user.telegramId,
      onixId: user.onixId,
      isAdmin: user.isAdmin,
    };
  }
}

/** Inspect JWT header alg without verifying signature. */
export function peekJwtAlg(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0]) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
      alg?: unknown;
    };
    return typeof header.alg === 'string' ? header.alg : null;
  } catch {
    return null;
  }
}
