import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64, SCRYPT).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const next = scryptSync(password, salt, 64, SCRYPT);
  const prev = Buffer.from(hash, 'base64url');
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip, 'utf8').digest('hex');
}

export function mintMfaCode(): string {
  // 6-digit, never log in production.
  return String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, '0');
}

export function hashMfaCode(code: string): string {
  return createHash('sha256').update(`admin-mfa:${code}`, 'utf8').digest('hex');
}
