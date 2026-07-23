import type { INestApplication } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'http';

const HEALTH_BODY = 'ONIX API';

type HealthRequest = IncomingMessage & { method?: string; url?: string; path?: string };
type HealthResponse = ServerResponse & {
  status: (code: number) => HealthResponse;
  type: (value: string) => HealthResponse;
  set: (field: string, value: string) => HealthResponse;
  send: (body: string) => void;
  end: () => void;
};

/**
 * Production health for Render (and load balancers).
 * Express middleware — runs before Nest router / AuthGuard / API envelope.
 *
 * HEAD / → 200 (LB probe; no body).
 * GET / → left for SPA (www shell). Use /api/health/live|ready for JSON health.
 * If SPA is not mounted, GET / still returns plain "ONIX API".
 */
export function registerHealthEndpoint(app: INestApplication, opts?: { spaEnabled?: boolean }): void {
  const spaEnabled = Boolean(opts?.spaEnabled);
  app.use((req: HealthRequest, res: HealthResponse, next: (err?: unknown) => void) => {
    const path = req.path ?? (req.url ? req.url.split('?')[0] : '');
    if (path !== '/') {
      next();
      return;
    }
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'HEAD') {
      res.set('Cache-Control', 'no-store');
      res.status(200).type('text/plain').set('Content-Length', String(Buffer.byteLength(HEALTH_BODY))).end();
      return;
    }
    if (method === 'GET' && !spaEnabled) {
      res.set('Cache-Control', 'no-store');
      res.status(200).type('text/plain').send(HEALTH_BODY);
      return;
    }
    next();
  });
}
