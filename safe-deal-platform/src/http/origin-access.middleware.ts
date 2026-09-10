import type { NextFunction, Request, Response } from 'express';

/**
 * Origin access hardening for DNS-only (grey-cloud) Amvera.
 *
 * Network firewall (allow only edge / Amvera peers) is still required for L3/L4.
 * This layer blocks casual direct-IP Host abuse and optional shared-secret edges.
 *
 * Env:
 *   ALLOWED_HOSTS=www.onixtg.shop,onixtg.shop   (required in production when set;
 *     default falls back to PUBLIC_WEB_HOST / www.onixtg.shop)
 *   ORIGIN_EDGE_SECRET=...   if set, require header X-ONIX-Edge-Secret (or CF-style)
 *   ORIGIN_GUARD=off         disable entirely (local only)
 */

const IP_HOST = /^(?:\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;

function headerValue(
  headers: Request['headers'],
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === 'string' ? raw : undefined;
}

export function parseAllowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.ALLOWED_HOSTS?.trim()
    || env.PUBLIC_WEB_HOST?.trim()
    || 'www.onixtg.shop,onixtg.shop';
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]!.split(':')[0]!)
    .filter(Boolean);
}

export function isLiteralIpHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return false;
  return IP_HOST.test(h);
}

export function originHostAllowed(
  hostHeader: string | undefined,
  allowed: string[],
): boolean {
  const host = String(hostHeader ?? '').split(':')[0]?.toLowerCase() ?? '';
  if (!host) return false;
  if (isLiteralIpHost(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (allowed.includes(host)) return true;
  // Amvera preview / internal health sometimes uses *.amvera.ru — allow only if listed.
  return false;
}

export function originEdgeSecretOk(
  req: Pick<Request, 'headers'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const secret = env.ORIGIN_EDGE_SECRET?.trim();
  if (!secret) return true;
  const given = headerValue(req.headers, 'x-onix-edge-secret')
    ?? headerValue(req.headers, 'x-origin-verify');
  return Boolean(given && given === secret);
}

function isHealthPath(path: string): boolean {
  return path === '/api/health/live'
    || path === '/api/health/ready'
    || path === '/health/live'
    || path === '/health/ready';
}

/**
 * Express middleware — apply early (after Helmet, before SPA/API).
 * Skips ACME challenges. In production rejects IP Host and unknown hosts.
 */
export function originAccessMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const mode = (process.env.ORIGIN_GUARD ?? 'on').trim().toLowerCase();
  if (mode === 'off' || mode === '0' || mode === 'false') {
    next();
    return;
  }

  const path = (req.originalUrl ?? req.url ?? '/').split('?')[0] || '/';
  if (path.startsWith('/.well-known/')) {
    next();
    return;
  }

  const production = (process.env.NODE_ENV ?? '').toLowerCase() === 'production'
    || process.env.AMVERA === '1'
    || (process.env.AMVERA ?? '').toLowerCase() === 'true';

  // Local/dev: do not break Vite proxy / curl to localhost.
  if (!production) {
    next();
    return;
  }

  const allowed = parseAllowedHosts();
  const hostOk = originHostAllowed(req.headers.host, allowed);
  if (!hostOk) {
    // Keep health reachable for Amvera probes that may use internal hostnames
    // only when ORIGIN_ALLOW_HEALTH_BYPASS=true (default on).
    const bypass = (process.env.ORIGIN_ALLOW_HEALTH_BYPASS ?? 'true').toLowerCase() !== 'false';
    if (bypass && isHealthPath(path)) {
      next();
      return;
    }
    res.status(421).type('text/plain').send('Misdirected Request');
    return;
  }

  if (!originEdgeSecretOk(req)) {
    res.status(403).type('text/plain').send('Forbidden');
    return;
  }

  next();
}
