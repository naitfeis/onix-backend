import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

function keyBytes(): Buffer {
  const raw = process.env.PRODUCT_DELIVERY_KEY?.trim();
  if (!raw) {
    throw new Error('PRODUCT_DELIVERY_KEY is not configured (32-byte base64).');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('PRODUCT_DELIVERY_KEY must decode to 32 bytes.');
  }
  return key;
}

/** Encrypt seller-provided delivery payload (login/password/key). Never log plaintext. */
export function encryptDeliverySecret(plaintext: string): { ciphertext: string; iv: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
  };
}

export function decryptDeliverySecret(ciphertextB64: string, ivB64: string): string {
  const buf = Buffer.from(ciphertextB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv(ALGO, keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
