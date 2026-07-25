import {
  createHash, randomBytes, sign, verify, type KeyObject,
} from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AdminRole } from '@prisma/client';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import { SECRETS_PROVIDER, type SecretsProvider } from '../auth-v2/secrets.provider';
import { SigningKeyService } from '../auth-v2/signing-key.service';

export const ADMIN_ACCESS_TYP = 'admin_access';
export const ADMIN_ACCESS_ISS = 'onix-admin-api';
export const ADMIN_ACCESS_AUD = 'onix-admin';
export const ADMIN_ACCESS_TTL_SECONDS = Number(process.env.ADMIN_ACCESS_TTL_SECONDS ?? 900);

export type AdminAccessClaims = {
  sub: string;
  sid: string;
  role: AdminRole;
  typ: typeof ADMIN_ACCESS_TYP;
  iss: typeof ADMIN_ACCESS_ISS;
  aud: typeof ADMIN_ACCESS_AUD;
  iat: number;
  exp: number;
};

@Injectable()
export class AdminTokenService {
  constructor(
    private readonly signingKeys: SigningKeyService,
    @Inject(SECRETS_PROVIDER) private readonly secrets: SecretsProvider,
  ) {}

  issueAccessToken(input: { adminUserId: bigint; sessionId: string; role: AdminRole }): string {
    const key = this.signingKeys.getCurrentForSigning();
    const now = Math.floor(Date.now() / 1000);
    const claims: AdminAccessClaims = {
      sub: input.adminUserId.toString(),
      sid: input.sessionId,
      role: input.role,
      typ: ADMIN_ACCESS_TYP,
      iss: ADMIN_ACCESS_ISS,
      aud: ADMIN_ACCESS_AUD,
      iat: now,
      exp: now + ADMIN_ACCESS_TTL_SECONDS,
    };
    const header = { alg: 'EdDSA', typ: 'JWT', kid: key.kid };
    const encodedHeader = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = sign(null, Buffer.from(signingInput, 'utf8'), key.privateKey as KeyObject);
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  verifyAccessToken(token: string): AdminAccessClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Admin access token format is invalid.');
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    let header: { alg?: string; kid?: string };
    try {
      header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as typeof header;
    } catch {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Admin access token header is invalid.');
    }
    if (header.alg !== 'EdDSA' || !header.kid) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Admin access token is invalid.');
    }
    const key = this.signingKeys.findPublicKey(header.kid);
    if (!key) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Admin access token kid is unknown.');
    }
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const ok = verify(
      null,
      Buffer.from(signingInput, 'utf8'),
      key.publicKey,
      Buffer.from(encodedSignature, 'base64url'),
    );
    if (!ok) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Admin access token signature is invalid.');
    }
    let payload: AdminAccessClaims;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AdminAccessClaims;
    } catch {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Admin access token payload is invalid.');
    }
    this.assertClaims(payload);
    return payload;
  }

  issueRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: createHash('sha256').update(token, 'utf8').digest('hex') };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private assertClaims(payload: AdminAccessClaims): void {
    const now = Math.floor(Date.now() / 1000);
    if (payload.typ !== ADMIN_ACCESS_TYP) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Customer tokens are not accepted on admin plane.');
    }
    if (payload.iss !== ADMIN_ACCESS_ISS || payload.aud !== ADMIN_ACCESS_AUD) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Admin access token audience is invalid.');
    }
    if (!payload.sub || !/^\d+$/.test(payload.sub) || !payload.sid) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Admin access token subject is invalid.');
    }
    if (!Number.isFinite(payload.exp) || payload.exp < now) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Admin access token has expired.');
    }
  }
}
