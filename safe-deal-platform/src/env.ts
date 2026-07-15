import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

/**
 * Load `.env` from cwd and common monorepo roots.
 * Does not override variables already set (Render / Docker inject env first).
 */
export function loadEnvFiles(): string | null {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../.env'), // dist/main.js → repo root
    resolve(__dirname, '../../.env'), // ts-node from safe-deal-platform/src
    resolve(__dirname, '../../../.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: false });
      return path;
    }
  }
  loadDotenv({ override: false });
  return null;
}

/** True when PRODUCT_DELIVERY_KEY is present and decodes to 32 bytes. */
export function isProductDeliveryKeyConfigured(): boolean {
  const raw = process.env.PRODUCT_DELIVERY_KEY?.trim();
  if (!raw) return false;
  try {
    return Buffer.from(raw, 'base64').length === 32;
  } catch {
    return false;
  }
}

/**
 * Startup check — never throws (auto-delivery is optional until used).
 * Logs clear status for local + Render operators.
 */
export function logProductDeliveryKeyStatus(log: { log: (m: string) => void; warn: (m: string) => void }): void {
  const raw = process.env.PRODUCT_DELIVERY_KEY?.trim();
  if (!raw) {
    log.warn(
      'PRODUCT_DELIVERY_KEY is not set — product autoDeliver create/purchase will fail until you add a 32-byte base64 key (Render Dashboard → Environment, or local .env). Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
    return;
  }
  try {
    const len = Buffer.from(raw, 'base64').length;
    if (len !== 32) {
      log.warn(
        `PRODUCT_DELIVERY_KEY is invalid (decoded ${len} bytes, need 32). Auto-delivery will fail until fixed.`,
      );
      return;
    }
    log.log('PRODUCT_DELIVERY_KEY OK (AES-256-GCM auto-delivery enabled).');
  } catch {
    log.warn('PRODUCT_DELIVERY_KEY is not valid base64 — auto-delivery disabled.');
  }
}
