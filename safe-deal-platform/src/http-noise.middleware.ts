import type { NextFunction, Request, Response } from 'express';

/**
 * Quiet common scanner / browser noise before ServeStatic / Nest.
 * Always empty 404 — never 500 / stack traces for probes.
 */
export function httpNoiseMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }

  const path = (req.path || req.url || '').split('?')[0] || '';
  const lower = path.toLowerCase();

  if (path === '/favicon.ico') {
    res.redirect(302, '/favicon.svg');
    return;
  }

  if (isScannerPath(lower)) {
    res.status(404).type('text/plain').end();
    return;
  }

  next();
}

function isScannerPath(path: string): boolean {
  if (
    path === '/.env'
    || path.startsWith('/.env.')
    || path.includes('/.env')
    || path.startsWith('/.git')
    || path.startsWith('/.aws')
    || path.startsWith('/.svn')
    || path.startsWith('/.hg')
    || path === '/.ds_store'
    || path === '/actuator'
    || path.startsWith('/actuator/')
    || path === '/server-status'
    || path === '/phpmyadmin'
    || path.startsWith('/phpmyadmin/')
    || path === '/wp-login.php'
    || path === '/wp-admin'
    || path.startsWith('/wp-admin/')
    || path === '/xmlrpc.php'
    || path === '/adminer'
    || path.startsWith('/adminer')
    || path === '/config.json'
    || path === '/web.config'
  ) {
    return true;
  }

  if (
    path.endsWith('.php')
    || path.endsWith('.asp')
    || path.endsWith('.aspx')
    || path.endsWith('.jsp')
    || path.endsWith('.cgi')
    || path.endsWith('.bak')
    || path.endsWith('.sql')
    || path.endsWith('.old')
    || path.endsWith('.swp')
    || path.endsWith('~')
    || path.endsWith('.env')
    || path.endsWith('.pem')
    || path.endsWith('.key')
  ) {
    return true;
  }

  if (
    path.includes('/backup')
    || path.includes('/dump')
    || path.includes('wp-config')
    || path.includes('phpinfo')
  ) {
    return true;
  }

  return false;
}
