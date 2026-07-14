import {
  createHash, generateKeyPairSync, randomBytes, sign, verify, type KeyObject,
} from 'crypto';
import { Injectable } from '@nestjs/common';
import { AuthPlatformError } from './auth-errors';
import { SigningKeyService } from './signing-key.service';

export const ACCESS_TOKEN_TYP = 'access';
export const ACCESS_TOKEN_ISS = 'onix-api';
export const ACCESS_TOKEN_AUD = 'onix-web';

/** ADR-033 */
export const JWT_CLOCK_SKEW_SECONDS = Number(process.env.JWT_CLOCK_SKEW_SECONDS ?? 30);

/** Default access TTL — ADR-028 */
export const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.AUTH_ACCESS_TTL_SECONDS ?? 900);

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  sv: number;
  pv: number;
  typ: typeof ACCESS_TOKEN_TYP;
  amr: string[];
  iss: typeof ACCESS_TOKEN_ISS;
  aud: typeof ACCESS_TOKEN_AUD;
  iat: number;
  exp: number;
}

export interface IssueAccessTokenInput {
  userId: bigint;
  sessionId: string;
  sessionVersion: number;
  permissionVersion: number;
  amr?: string[];
  ttlSeconds?: number;
}

export interface IssuedRefreshToken {
  /** Opaque token — return to client via cookie layer later; never log. */
  token: string;
  /** SHA-256 hex for Session.refreshTokenHash */
  hash: string;
}

@Injectable()
export class TokenService {
  constructor(private readonly signingKeys: SigningKeyService) {}

  issueAccessToken(input: IssueAccessTokenInput): string {
    const key = this.signingKeys.getCurrentForSigning();
    const now = Math.floor(Date.now() / 1000);
    const ttl = input.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS;
    const claims: AccessTokenClaims = {
      sub: input.userId.toString(),
      sid: input.sessionId,
      sv: input.sessionVersion,
      pv: input.permissionVersion,
      typ: ACCESS_TOKEN_TYP,
      amr: input.amr ?? ['telegram'],
      iss: ACCESS_TOKEN_ISS,
      aud: ACCESS_TOKEN_AUD,
      iat: now,
      exp: now + ttl,
    };

    const header = { alg: 'EdDSA', typ: 'JWT', kid: key.kid };
    const encodedHeader = base64urlJson(header);
    const encodedPayload = base64urlJson(claims);
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = sign(null, Buffer.from(signingInput, 'utf8'), key.privateKey as KeyObject);
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token format is invalid.');
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    let header: { alg?: string; typ?: string; kid?: string };
    try {
      header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as typeof header;
    } catch {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token header is invalid.');
    }

    if (header.alg !== 'EdDSA') {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token algorithm is not EdDSA.');
    }
    if (!header.kid) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token kid is missing.');
    }

    const key = this.signingKeys.findPublicKey(header.kid);
    if (!key) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token kid is unknown.');
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = Buffer.from(encodedSignature, 'base64url');
    const ok = verify(null, Buffer.from(signingInput, 'utf8'), key.publicKey, signature);
    if (!ok) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token signature is invalid.');
    }

    let payload: AccessTokenClaims;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AccessTokenClaims;
    } catch {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token payload is invalid.');
    }

    this.assertClaims(payload);
    return payload;
  }

  issueRefreshToken(): IssuedRefreshToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
  private assertClaims(payload: AccessTokenClaims): void {
    const now = Math.floor(Date.now() / 1000);
    const skew = JWT_CLOCK_SKEW_SECONDS;

    if (payload.typ !== ACCESS_TOKEN_TYP) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token typ is invalid.');
    }
    if (payload.iss !== ACCESS_TOKEN_ISS) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token issuer is invalid.');
    }
    if (payload.aud !== ACCESS_TOKEN_AUD) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token audience is invalid.');
    }
    if (!payload.sub || !/^\d+$/.test(payload.sub)) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token subject is invalid.');
    }
    if (!payload.sid || typeof payload.sid !== 'string') {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token session id is invalid.');
    }
    if (!Number.isInteger(payload.sv) || payload.sv < 0) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token sessionVersion is invalid.');
    }
    if (!Number.isInteger(payload.pv) || payload.pv < 0) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token permissionVersion is invalid.');
    }
    if (!Number.isFinite(payload.exp) || payload.exp + skew < now) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token has expired.');
    }
    if (!Number.isFinite(payload.iat) || payload.iat - skew > now) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token iat is in the future.');
    }
  }
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Test/ops helper: generate a PEM key pair for AUTH_ED25519_CURRENT_*. */
export function generateEd25519PemPair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}
