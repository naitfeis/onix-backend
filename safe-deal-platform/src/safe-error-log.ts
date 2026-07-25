/**
 * Redacts auth secrets from strings before they hit process logs.
 * Covers Bearer tokens, JWT-shaped blobs, cookies, PEM blocks, refresh cookie values,
 * and named env-style secret assignments (Slice 5).
 */
const REDACTED = '[REDACTED]';

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,
  /(?:__Host-)?onix_rt=[^;\s]+/gi,
  /(?:^|;\s*)(?:cookie|set-cookie)\s*[:=]\s*[^\n]+/gi,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /-----BEGIN [A-Z0-9 ]*PUBLIC KEY-----[\s\S]*?-----END [A-Z0-9 ]*PUBLIC KEY-----/g,
  /AUTH_ED25519_(?:CURRENT|PREVIOUS)_(?:PRIVATE|PUBLIC)_PEM\s*[:=]\s*["']?[^"'\s]+/gi,
  /(?:DEVICE_HMAC_SECRET|JWT_SECRET)\s*[:=]\s*["']?[^"'\s,;]+/gi,
  /(?:authorization|refresh[_-]?token|access[_-]?token)\s*[:=]\s*["']?[^"'\s,;]+/gi,
  // Telegram / bot / webhook / payment secrets
  /(?:bot[_-]?token|telegram[_-]?bot[_-]?token|TELEGRAM_BOT_TOKEN|BOT_TOKEN)\s*[:=]\s*["']?\d+:[A-Za-z0-9_-]+/gi,
  /\d{8,12}:[A-Za-z0-9_-]{30,}/g,
  /(?:initData|init_data|telegram[_-]?init[_-]?data)\s*[:=]\s*["']?[^"'\s]+/gi,
  /(?:webhook[_-]?secret|WEBHOOK_SECRET|TELEGRAM_WEBHOOK_SECRET|payment[_-]?secret|YOOKASSA[_-]?(?:SECRET|SHOP_ID)|SENTRY_DSN)\s*[:=]\s*["']?[^"'\s]+/gi,
  /(?:PRODUCT_DELIVERY_KEY|OPS_METRICS_TOKEN|ALERT_WEBHOOK_URL|ERROR_WEBHOOK_URL)\s*[:=]\s*["']?[^"'\s]+/gi,
];

export function redactSecrets(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/** Safe one-line summary for exception logging — never dumps raw Error.message unfiltered. */
export function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || 'Error';
    const message = redactSecrets(error.message || '');
    const stack = error.stack ? redactSecrets(error.stack) : undefined;
    return stack ? `${name}: ${message}\n${stack}` : `${name}: ${message}`;
  }
  if (typeof error === 'string') return redactSecrets(error);
  try {
    return redactSecrets(JSON.stringify(error));
  } catch {
    return '[unserializable error]';
  }
}
