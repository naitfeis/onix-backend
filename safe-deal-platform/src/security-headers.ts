import type { IncomingMessage, ServerResponse } from 'http';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

/**
 * Security headers for same-origin SPA + API on Render.
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
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'", 'https://oauth.telegram.org'],
        scriptSrc: [
          "'self'",
          'https://telegram.org',
          'https://oauth.telegram.org',
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'wss:', 'ws:'],
        frameSrc: [
          'https://oauth.telegram.org',
          'https://telegram.org',
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
