/**
 * Resolve the real client IP behind Cloudflare / Render / Vite proxies.
 *
 * Prefer CDN headers when present; never trust a client-supplied body field.
 */

export type ClientIpRequestLike = {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
};

const LOOPBACK = new Set(['127.0.0.1', '::1', '0:0:0:0:0:0:0:1', 'localhost']);

export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;

  // Surrounding brackets for IPv6 literals: [::1]
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }

  // Strip optional port on IPv4 host:port (not IPv6).
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.replace(/:\d+$/, '');
  }

  // IPv4-mapped IPv6
  if (value.toLowerCase().startsWith('::ffff:')) {
    value = value.slice(7);
  }

  return value || null;
}

export function isLoopbackIp(ip: string | null | undefined): boolean {
  const n = normalizeIp(ip);
  if (!n) return false;
  return LOOPBACK.has(n.toLowerCase()) || n.startsWith('127.');
}

function headerFirst(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function splitForwarded(value: string): string[] {
  return value
    .split(',')
    .map((part) => normalizeIp(part))
    .filter((part): part is string => Boolean(part));
}

function isPrivateOrLocal(ip: string): boolean {
  const n = ip.toLowerCase();
  if (isLoopbackIp(n)) return true;
  if (n.startsWith('10.')) return true;
  if (n.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(n)) return true;
  if (n.startsWith('fc') || n.startsWith('fd') || n.startsWith('fe80:')) return true;
  return false;
}

/**
 * Pick the best client IP from proxy/CDN headers + Express `req.ip`.
 * Returns null only when nothing usable is present.
 */
export function resolveClientIp(req: ClientIpRequestLike): string | null {
  const headers = req.headers ?? {};

  const cf = normalizeIp(headerFirst(headers, 'cf-connecting-ip'));
  if (cf && !isLoopbackIp(cf)) return cf;

  const trueClient = normalizeIp(headerFirst(headers, 'true-client-ip'));
  if (trueClient && !isLoopbackIp(trueClient)) return trueClient;

  const realIp = normalizeIp(headerFirst(headers, 'x-real-ip'));
  if (realIp && !isLoopbackIp(realIp)) return realIp;

  const forwarded = headerFirst(headers, 'x-forwarded-for');
  if (forwarded) {
    const chain = splitForwarded(forwarded);
    const publicIp = chain.find((ip) => !isPrivateOrLocal(ip));
    if (publicIp) return publicIp;
    // All private (local proxy chain) — still prefer leftmost over Express peer.
    if (chain[0] && !isLoopbackIp(chain[0])) return chain[0];
    if (chain[0]) return chain[0];
  }

  const expressIp = normalizeIp(req.ip) ?? normalizeIp(req.socket?.remoteAddress);
  return expressIp;
}

/** Display helper for security prompts — never invent an IP. */
export function formatClientIpForPrompt(ip: string | null | undefined): string {
  const n = normalizeIp(ip);
  if (!n) return 'скрыт';
  if (isLoopbackIp(n)) return `${n} (локально)`;
  return n;
}
