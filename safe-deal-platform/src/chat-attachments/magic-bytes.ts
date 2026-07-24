/**
 * Magic-byte / signature checks — never trust client Content-Type alone.
 */

export type DetectedKind = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf' | 'text/plain';

export function detectMimeFromMagic(buf: Buffer): DetectedKind | null {
  if (buf.length < 12) return null;

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';

  // PNG
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png';
  }

  // GIF
  if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'image/gif';
  }

  // WEBP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF'
    && buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  // PDF
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';

  // text/plain: no NUL in sample, mostly printable / whitespace
  if (looksLikePlainText(buf)) return 'text/plain';

  return null;
}

function looksLikePlainText(buf: Buffer): boolean {
  let printable = 0;
  const n = Math.min(buf.length, 512);
  for (let i = 0; i < n; i += 1) {
    const c = buf[i]!;
    if (c === 0) return false;
    if (
      c === 0x09 || c === 0x0a || c === 0x0d
      || (c >= 0x20 && c <= 0x7e)
      || c >= 0x80
    ) {
      printable += 1;
    }
  }
  return printable / n >= 0.85;
}

/** Declared MIME must match detected kind (text/plain is soft). */
export function mimeMatchesMagic(declared: string, detected: DetectedKind | null): boolean {
  if (!detected) return false;
  if (declared === detected) return true;
  // Accept jpeg aliases
  if (declared === 'image/jpg' && detected === 'image/jpeg') return true;
  return false;
}
