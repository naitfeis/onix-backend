import type { NextFunction, Request, Response } from 'express';

/**
 * Quiet common scanner / browser noise before ServeStatic / Nest.
 * Avoids NotFoundException stack traces for /.env, missing favicon.ico, etc.
 */
export function httpNoiseMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }

  const path = (req.path || '').split('?')[0] || '';

  if (path === '/favicon.ico') {
    res.redirect(302, '/favicon.svg');
    return;
  }

  // Opportunistic scanners — empty 404, no SPA, no exception filter noise.
  if (
    path === '/.env'
    || path.startsWith('/.env.')
    || path.startsWith('/.git')
    || path.startsWith('/.aws')
    || path.endsWith('.php')
    || path === '/wp-login.php'
    || path === '/wp-admin'
    || path.startsWith('/wp-admin/')
    || path === '/xmlrpc.php'
    || path === '/actuator'
    || path.startsWith('/actuator/')
    || path === '/server-status'
    || path === '/phpmyadmin'
    || path.startsWith('/phpmyadmin/')
  ) {
    res.status(404).end();
    return;
  }

  next();
}
