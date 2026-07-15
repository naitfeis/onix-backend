import { createPrivateKey, createPublicKey, type KeyObject } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuthPlatformError } from './auth-errors';
import { SECRETS_PROVIDER, type SecretsProvider } from './secrets.provider';

export type SigningKeyStatusRole = 'CURRENT' | 'PREVIOUS';

export interface ResolvedSigningKey {
  kid: string;
  algorithm: 'EdDSA';
  role: SigningKeyStatusRole;
  privateKey?: KeyObject;
  publicKey: KeyObject;
}

const CURRENT_KID = 'AUTH_ED25519_CURRENT_KID';
const CURRENT_PRIVATE = 'AUTH_ED25519_CURRENT_PRIVATE_PEM';
const CURRENT_PUBLIC = 'AUTH_ED25519_CURRENT_PUBLIC_PEM';
const PREVIOUS_KID = 'AUTH_ED25519_PREVIOUS_KID';
const PREVIOUS_PUBLIC = 'AUTH_ED25519_PREVIOUS_PUBLIC_PEM';

/**
 * Loads CURRENT (sign+verify) and optional PREVIOUS (verify-only) Ed25519 keys.
 * Private material never leaves SecretsProvider / KeyObject in-process.
 */
@Injectable()
export class SigningKeyService {
  private cached: ResolvedSigningKey[] | null = null;

  constructor(@Inject(SECRETS_PROVIDER) private readonly secrets: SecretsProvider) {}

  /** Invalidate in-memory cache after rotation / secret reload. */
  clearCache(): void {
    this.cached = null;
  }

  getCurrentForSigning(): ResolvedSigningKey {
    const current = this.loadKeys().find((key) => key.role === 'CURRENT');
    if (!current?.privateKey) {
      throw new AuthPlatformError(
        'AUTH_MISCONFIGURED',
        'Ed25519 signing key is not configured (AUTH_ED25519_CURRENT_*).',
      );
    }
    return current;
  }

  /** Keys accepted for access-token verification (CURRENT + PREVIOUS). */
  getKeysForVerification(): ResolvedSigningKey[] {
    return this.loadKeys();
  }

  findPublicKey(kid: string): ResolvedSigningKey | undefined {
    return this.loadKeys().find((key) => key.kid === kid);
  }

  private loadKeys(): ResolvedSigningKey[] {
    if (this.cached) return this.cached;

    const kid = this.secrets.get(CURRENT_KID);
    const privatePem = this.secrets.get(CURRENT_PRIVATE);
    const publicPem = this.secrets.get(CURRENT_PUBLIC);

    if (!kid || !privatePem || !publicPem) {
      this.cached = [];
      return this.cached;
    }

    // Render one-line env: literal "\n" must become real newlines before OpenSSL decode.
    const privateKeyPem = normalizePem(privatePem);
    const publicKeyPem = normalizePem(publicPem);

    const keys: ResolvedSigningKey[] = [
      {
        kid,
        algorithm: 'EdDSA',
        role: 'CURRENT',
        privateKey: createPrivateKey(privateKeyPem),
        publicKey: createPublicKey(publicKeyPem),
      },
    ];

    const prevKid = this.secrets.get(PREVIOUS_KID);
    const prevPublic = this.secrets.get(PREVIOUS_PUBLIC);
    if (prevKid && prevPublic) {
      keys.push({
        kid: prevKid,
        algorithm: 'EdDSA',
        role: 'PREVIOUS',
        publicKey: createPublicKey(normalizePem(prevPublic)),
      });
    }

    this.cached = keys;
    return this.cached;
  }
}

/** Additive: `-----BEGIN...\\nBASE64...` (Render) → standard PEM for createPrivateKey. */
function normalizePem(value: string): string {
  return value.trim().replace(/\\n/g, '\n');
}
