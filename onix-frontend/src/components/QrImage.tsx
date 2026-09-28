/**
 * Renders a bank QR code returned by the PSP.
 *
 * T-Bank GetQr can answer with either an SVG or a raster image depending on
 * DataType and terminal settings, so the content type is sniffed from the
 * decoded bytes and injected as a data URL into <img>. That keeps the payload
 * untrusted-data-safe: no dangerouslySetInnerHTML, no script execution path.
 */

type DetectedImage = { dataUrl: string; mime: string };

function decodeBase64Bytes(base64: string): Uint8Array | null {
  try {
    const clean = base64.trim().replace(/\s+/g, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Detect SVG / PNG / JPEG so the right data URL mime is used. */
export function detectQrImage(base64: string): DetectedImage | null {
  const bytes = decodeBase64Bytes(base64);
  if (!bytes || bytes.length === 0) return null;
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) {
    return { dataUrl: `data:image/svg+xml;base64,${base64.trim().replace(/\s+/g, '')}`, mime: 'image/svg+xml' };
  }
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng) return { dataUrl: `data:image/png;base64,${base64.trim().replace(/\s+/g, '')}`, mime: 'image/png' };
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isJpeg) return { dataUrl: `data:image/jpeg;base64,${base64.trim().replace(/\s+/g, '')}`, mime: 'image/jpeg' };
  return null;
}

/** True when the payload is a scannable/openable URL (SBP deep link). */
export function isUrlPayload(payload: string): boolean {
  return /^https?:\/\//i.test(payload.trim());
}

export function QrImage({
  imageBase64,
  payload,
  label,
}: {
  /** Base64 image body from GetQr(DataType=IMAGE). */
  imageBase64?: string | null;
  /** Raw QR payload from GetQr(DataType=PAYLOAD) — used as a fallback. */
  payload?: string | null;
  label?: string;
}) {
  const detected = imageBase64 ? detectQrImage(imageBase64) : null;
  if (detected) {
    return (
      <div className="payment-qr">
        <img className="payment-qr__img" src={detected.dataUrl} alt={label ?? 'QR-код для оплаты'} width={220} height={220} />
      </div>
    );
  }
  if (!payload) return null;
  // No raster/SVG from the PSP: offer the payload as an openable SBP link and
  // keep it copyable instead of pretending it is a QR.
  return (
    <div className="payment-qr">
      <p className="muted">QR-изображение недоступно. Откройте ссылку оплаты в приложении банка или скопируйте код ниже.</p>
      <code className="payment-qr-payload">{payload}</code>
    </div>
  );
}

export default QrImage;