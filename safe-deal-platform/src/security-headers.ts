import type { IncomingMessage, ServerResponse } from 'http';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

/**
 * Security headers for same-origin SPA + API (Amvera production / Render staging).
 * CSP allows Telegram Login Widget / oauth frames; avatars are same-origin only.
 */
export function createSecurityMiddleware(): (
  req: Request | IncomingMessage,
  res: Response | ServerResponse,
  next: NextFunction,
) => void {
  return helmet({
    // SPA + Nest on one origin — no cross-origin embed needed.
    crossOriginEmbedderPolicy: false,
    // GIS popup is not used; Telegram widget is an iframe. Keep allow-popups
    // so oauth.telegram.org / future account pickers are not COOP-blocked.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: [
          "'self'",
          'https://oauth.telegram.org',
          'https://accounts.google.com',
        ],
        scriptSrc: [
          "'self'",
          'https://telegram.org',
          'https://oauth.telegram.org',
          'https://accounts.google.com',
          'https://www.gstatic.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://www.gstatic.com', 'https://accounts.google.com'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: [
          "'self'",
          'wss:',
          'ws:',
          'https://accounts.google.com',
        ],
        frameSrc: [
          'https://oauth.telegram.org',
          'https://telegram.org',
          'https://accounts.google.com',
        ],
        upgradeInsecureRequests: [],
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }) as (req: Request | IncomingMessage, res: Response | ServerResponse, next: NextFunction) => void;
}

/** Production CORS — never include localhost unless explicitly listed in CORS_ORIGINS. */
export function resolveCorsOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;

  const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
  if (isProd) {
    return ['https://www.onixtg.shop', 'https://onixtg.shop'];
  }
  return [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://www.onixtg.shop',
    'https://onixtg.shop',
  ];
}

/**
 * __Host- cookies are host-bound. Apex and www are different sessions.
 * ACME and Amvera preview hosts must not be redirected.
 */
export function canonicalWwwHostMiddleware(req: Request, res: Response, next: NextFunction): void {
  const host = String(req.headers.host ?? '').split(':')[0]?.toLowerCase() ?? '';
  if (host !== 'onixtg.shop') {
    next();
    return;
  }
  const path = (req.originalUrl ?? req.url ?? '/').split('?')[0] || '/';
  if (path.startsWith('/.well-known/')) {
    next();
    return;
  }
  res.redirect(301, `https://www.onixtg.shop${req.originalUrl || '/'}`);
}
