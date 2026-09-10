import type { NextFunction, Request, Response } from 'express';
import {
  isHealthPath,
  originHostAllowed,
  originLaunchPosture,
  originSniAllowed,
  parseAllowedHosts,
  tlsServerName,
} from './origin-access.policy';

/**
 * Origin access hardening for DNS-only (grey-cloud) Amvera.
 *
 * IMPORTANT (senior truth):
 *   Host allowlist does NOT stop `https://<ingress-ip>` with `Host: www.onixtg.shop`.
 *   On grey-cloud that path is DNS-equivalent (A record → same IP). Cloudflare WAF is
 *   not in the request path. Closing "bypass CF" requires either:
 *     (a) ORIGIN_EDGE_SECRET + edge that injects X-ONIX-Edge-Secret + Amvera allowlist, or
 *     (b) explicit ORIGIN_GREY_CLOUD_ACK after accepting app rate-limits as the perimeter.
 *
 * Env:
 *   ALLOWED_HOSTS=www.onixtg.shop,onixtg.shop
 *   ORIGIN_EDGE_SECRET=...          require X-ONIX-Edge-Secret / X-Origin-Verify
 *   ORIGIN_GREY_CLOUD_ACK=...       conscious accept of public-IP entry
 *   ORIGIN_ALLOW_HEALTH_BYPASS      default false for literal-IP Host (was true — loophole)
 *   ORIGIN_GUARD=off                disable (local only)
 */

function headerValue(
  headers: Request['headers'],
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === 'string' ? raw : undefined;
}

export {
  isLiteralIpHost,
  isHealthPath,
  originHostAllowed,
  originLaunchPosture,
  originSniAllowed,
  parseAllowedHosts,
  tlsServerName,
} from './origin-access.policy';

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

  if (!production) {
    next();
    return;
  }

  const allowed = parseAllowedHosts();
  const hostHeader = req.headers.host;
  const hostOk = originHostAllowed(hostHeader, allowed);
  const hostOnly = String(hostHeader ?? '').split(':')[0]?.toLowerCase() ?? '';

  // Literal-IP Host: never serve the app (including health). Amvera probes must use a
  // hostname in ALLOWED_HOSTS or an internal mesh name listed there — not the public IP.
  if (!hostOk) {
    const bypass = (process.env.ORIGIN_ALLOW_HEALTH_BYPASS ?? 'false').toLowerCase() === 'true';
    const literalIp = /^(?:\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i.test(hostOnly);
    if (bypass && isHealthPath(path) && !literalIp) {
      next();
      return;
    }
    res.status(421).type('text/plain').send('Misdirected Request');
    return;
  }

  const sni = tlsServerName(req.socket as { servername?: string });
  if (!originSniAllowed(sni, allowed)) {
    res.status(421).type('text/plain').send('Misdirected Request');
    return;
  }

  if (!originEdgeSecretOk(req)) {
    res.status(403).type('text/plain').send('Forbidden');
    return;
  }

  next();
}

/** Call once at bootstrap in production — fail closed without edge secret or grey-cloud ACK. */
export function assertOriginLaunchGate(env: NodeJS.ProcessEnv = process.env): void {
  const production = (env.NODE_ENV ?? '').toLowerCase() === 'production'
    || env.AMVERA === '1'
    || (env.AMVERA ?? '').toLowerCase() === 'true';
  if (!production) return;
  if ((env.ORIGIN_GUARD ?? 'on').trim().toLowerCase() === 'off') return;
  const posture = originLaunchPosture(env);
  if (!posture.ok) {
    throw new Error(`[FATAL] Origin launch gate: ${posture.detail}`);
  }
}
