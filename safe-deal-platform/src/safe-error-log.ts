/**
 * Redacts auth secrets from strings before they hit process logs.
 * Covers Bearer tokens, JWT-shaped blobs, cookies, PEM blocks, refresh cookie values.
 */
const REDACTED = '[REDACTED]';

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,
  /(?:__Host-)?onix_rt=[^;\s]+/gi,
  /(?:^|;\s*)(?:cookie|set-cookie)\s*[:=]\s*[^\n]+/gi,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /AUTH_ED25519_CURRENT_PRIVATE_PEM\s*[:=]\s*["']?[^"'\s]+/gi,
  /(?:authorization|refresh[_-]?token|access[_-]?token)\s*[:=]\s*["']?[^"'\s,;]+/gi,
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
