/** Attachment size policy — FREE now; PRO reserved for later. */

export type AttachmentTier = 'FREE' | 'PRO' | 'ADMIN';

const MIB = 1024 * 1024;

const LIMITS: Record<AttachmentTier, number> = {
  FREE: 20 * MIB,
  PRO: 100 * MIB,
  ADMIN: 100 * MIB,
};

export function attachmentTierForUser(opts: {
  isAdmin?: boolean;
  isSupport?: boolean;
  platformStatus?: string | null;
}): AttachmentTier {
  const status = opts.platformStatus ?? '';
  if (
    opts.isAdmin
    || opts.isSupport
    || status === 'ADMIN'
    || status === 'SUPER_ADMIN'
    || status === 'MODERATOR'
  ) {
    return 'ADMIN';
  }
  // Pro not shipped yet — treat all others as FREE.
  return 'FREE';
}

export function getAttachmentMaxBytes(tier: AttachmentTier): number {
  return LIMITS[tier];
}

export const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const FILE_MIME = new Set([
  'application/pdf',
  'text/plain',
]);

export const ALLOWED_MIME = new Set([...IMAGE_MIME, ...FILE_MIME]);

export function contentTypeForMime(mime: string): 'IMAGE' | 'FILE' {
  return IMAGE_MIME.has(mime) ? 'IMAGE' : 'FILE';
}

export function sanitizeOriginalName(name: string): string {
  const base = name.replace(/[/\\]/g, '').trim().slice(0, 200);
  return base || 'file';
}
