import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Seller phone capture for anti-fraud.
 *
 * The raw number is NEVER stored: only an HMAC-SHA256 over the E.164 form, keyed by
 * PHONE_HASH_SECRET. A keyed hash (not plain SHA-256) is deliberate — an unkeyed hash
 * of a phone number is brute-forceable offline because the space is small and public.
 *
 * Telegram delivers the number to the BOT webhook (`message.contact`), not to the Mini
 * App; the Mini App only learns `contactRequested: sent | cancelled`.
 */
export function phoneHashSecret(): string {
  const raw = process.env.PHONE_HASH_SECRET?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Missing required secret: PHONE_HASH_SECRET');
    }
    return 'onix-dev-phone-hash-not-for-production';
  }
  return raw;
}

/** Normalize to E.164: strip separators, collapse the leading 00 trunk prefix. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const hasPlus = value.startsWith('+') || value.startsWith('00');
  let digits = value.replace(/[^\d]/g, '');
  // "0044..." is the European dialling form of "+44...". Without dropping the 00 the
  // same number would hash to two different values depending on how it was typed,
  // which would silently defeat the unique-phone anti-fraud anchor.
  if (hasPlus && digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  // Russian 8XXXXXXXXXX is a domestic form of +7XXXXXXXXXX.
  if (!hasPlus && digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (!hasPlus && digits.length === 10) return `+7${digits}`;
  return `+${digits}`;
}

/**
 * Display form for logs and bot replies. Reveals at most the last two digits and
 * nothing at all for values too short to be a phone — never the middle.
 */
export function maskPhone(normalized: string): string {
  const digits = normalized.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `+${'*'.repeat(Math.max(1, digits.length - 2))}${digits.slice(-2)}`;
}

export function hashPhone(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(raw);
  if (!normalized) return null;
  return createHmac('sha256', phoneHashSecret()).update(normalized).digest('hex').slice(0, 64);
}

/** Constant-time comparison so hash lookups cannot be timed side-channelled. */
export function samePhoneHash(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Whether selling requires a shared phone number.
 * Default true — a marketplace with escrow must be able to identify its sellers.
 */
export function phoneRequiredToSell(): boolean {
  const raw = (process.env.SELLER_PHONE_REQUIRED ?? 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

