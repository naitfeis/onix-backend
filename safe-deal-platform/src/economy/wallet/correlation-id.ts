import { randomBytes } from 'crypto';
import type { Request } from 'express';

/** Prefer X-Request-Id; otherwise mint a short opaque id (workers / no HTTP). */
export function resolveCorrelationId(req?: Request | null): string {
  const header = req?.headers?.['x-request-id'];
  if (typeof header === 'string' && header.trim()) return header.trim().slice(0, 64);
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim().slice(0, 64);
  return randomBytes(12).toString('hex');
}
